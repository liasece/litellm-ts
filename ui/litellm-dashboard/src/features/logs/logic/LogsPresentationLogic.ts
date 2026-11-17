import type { LogEntry } from "../support/LogsModels";
import { isInProgressLog } from "./LogsIdentityLogic";
import { modelSupplier } from "../../providers/logic/ProviderIdentityLogic";
import { MIN_GENERATION_SHARE_FOR_TPS, MIN_GENERATION_WINDOW_MS, MIN_OUTPUT_TOKENS_FOR_TPS } from "../../../../../../src/shared/ModelSpeed";
export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : undefined;
}
/**
 * 读取缓存 token 数。
 *
 * 详情接口 compact 模式把标量列（cache_read_input_tokens / cache_creation_input_tokens）
 * 单独下发；有该列时优先采用，缺失或非法值（负数、NaN、字符串）才回退解析 metadata，
 * 保证旧接口与历史行仍按原逻辑工作。
 * @param metadata - 日志 metadata
 * @param creation - 是否读取 cache creation（否则 cache read）
 * @param directValue - 接口顶层标量列的值
 */
export function cacheTokens(metadata: LogEntry["metadata"], creation = false, directValue?: unknown): number {
	if (typeof directValue === "number" && Number.isFinite(directValue) && directValue >= 0) return directValue;
	const source = record(metadata),
		additional = record(source.additional_usage_values),
		usage = record(source.usage_object);
	const names = creation
		? ["cache_creation_input_tokens", "cache_creation_tokens", "cache_write_tokens"]
		: ["cache_read_input_tokens", "cached_tokens", "cached_tokens"];
	for (const data of [additional, usage]) {
		for (const candidate of [
			data[names[0]],
			record(data.prompt_tokens_details)[names[1]],
			record(data.input_tokens_details)[names[2]],
		]) {
			const value = nonNegative(candidate);
			if (value !== undefined) return value;
		}
	}
	return 0;
}
export interface TokenMetrics {
	cacheRead: number;
	creation: number;
	input: number;
	output: number;
}
export function tokenMetrics(log: LogEntry): TokenMetrics {
	const safe = (value: unknown) => {
		const n = Number(value ?? 0);
		return Number.isFinite(n) ? Math.max(n, 0) : 0;
	};
	const cacheRead = cacheTokens(log.metadata, false, log.cache_read_input_tokens),
		creation = cacheTokens(log.metadata, true, log.cache_creation_input_tokens);
	return { cacheRead, creation, input: Math.max(safe(log.prompt_tokens) - cacheRead, 0), output: safe(log.completion_tokens) };
}
/**
 * 进行中的请求还没有 usage，列表投影里的 token 字段只是占位 0。
 * 三段用量都为 0 时视为无数据，避免把占位值当成实测用量展示。
 * @param log - 待展示的日志行
 */
export function tokenDataPending(log: LogEntry): boolean {
	const metrics = tokenMetrics(log);
	return isInProgressLog(log) && metrics.cacheRead === 0 && metrics.input === 0 && metrics.output === 0;
}
export function localLogTime(value: string): string {
	try {
		return new Date(value)
			.toLocaleString("en-US", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false,
			})
			.replace(",", "");
	} catch {
		return "Error converting time";
	}
}
export function logStatus(log: LogEntry): string {
	return String(log.metadata?.status || log.status || "success").toLowerCase();
}
export function modelIdentity(log: LogEntry) {
	const model = log.model || "";
	const request = record(record(log.proxy_server_request).upstream_request);
	const upstream = record(request.body).model;
	const upstreamModel = typeof upstream === "string" ? upstream.trim() : "";
	const executed = upstreamModel || model;
	const provider = modelSupplier(model, log.custom_llm_provider) || modelSupplier(executed, log.custom_llm_provider);
	const prefix = log.custom_llm_provider || "";
	const displayName = prefix && model.toLowerCase().startsWith(prefix.toLowerCase() + "/") ? model.slice(prefix.length + 1) : model;
	const metadata = record(log.metadata),
		tool = record(metadata.mcp_tool_call_metadata);
	const storedFamily = record(record(metadata.model_map_information).model_map_value).model_family;
	const live = isInProgressLog(log);
	let family: string | null | undefined;
	if ((live || !upstreamModel) && (typeof storedFamily === "string" || storedFamily === null)) {
		family = storedFamily;
	} else if (live && !provider && !upstreamModel) {
		family = null;
	}
	const toolLogo = typeof tool.mcp_server_logo_url === "string" ? tool.mcp_server_logo_url : "";
	const builtin = metadata.internal_call_type === "builtin_capability" ? String(metadata.builtin_capability || "unknown") : null;
	const fallback = Array.isArray(metadata.fallback_models) ? Math.max(metadata.fallback_models.length - 1, 0) : 0;
	return { provider, executed, family, displayName, toolLogo, builtin, fallback };
}
/** TPS 的分母必须是可独立测量的一段耗时，不能把首字等待和生成时间混在一起。 */
export interface TpsValue {
	value: number;
	tokens: number;
	seconds: number;
}
export interface TpsMetrics {
	/** 输入 TPS 覆盖首字之前的预填充阶段 */
	input: TpsValue;
	/** 输出不足 20 token 或没有生成窗口时为 null */
	output: TpsValue | null;
}
/**
 * 计算输入/输出 TPS。
 *
 * 输入 TPS 用首字等待（TTFT）作分母，输出 TPS 用首字之后的生成时间作分母；
 * 两者不能都除以总耗时，否则输出速度会被首字等待稀释。TTFT 缺失、早于请求开始，
 * 或不早于结束（非流式请求的 TTFT 通常等于总耗时）时没有可分离的生成窗口，整格不显示。
 * 上游把整段回答缓冲到最后才写出时，首字与结束也只差几毫秒；生成窗口不足总耗时
 * MIN_GENERATION_SHARE_FOR_TPS 或不足 MIN_GENERATION_WINDOW_MS 的行同样按「TTFT 已占满请求」
 * 隐藏，避免把交付毛刺画成模型速度。两个门槛缺一不可：比例挡长请求里的几毫秒窗口，
 * 绝对下限挡短请求里的几十毫秒窗口（按比例看合法，算出来却是上万 TPS）。
 * 输出 TPS 继续沿用 MIN_OUTPUT_TOKENS_FOR_TPS 下限，避免极短响应的速度被首字等待主导。
 * @param log - 日志行
 */
export function tpsMetrics(log: LogEntry): TpsMetrics | null {
	const start = new Date(log.startTime).getTime();
	const first = log.completionStartTime ? new Date(log.completionStartTime).getTime() : Number.NaN;
	const end = log.endTime ? new Date(log.endTime).getTime() : Number.NaN;
	if (!Number.isFinite(start) || !Number.isFinite(first) || !Number.isFinite(end) || first <= start || first >= end) {
		return null;
	}
	const ttft = (first - start) / 1000;
	const duration = (end - start) / 1000;
	// 生成窗口按毫秒差直接换算，不用 (duration - ttft)：两个浮点秒相减会在门槛
	// 附近放大误差（0.1 秒变成 0.09999999999999964），显示值与判断值随之不一致
	const generationMs = end - first;
	const generation = generationMs / 1000;
	if (!(ttft > 0) || !(duration > 0) || !(generation > 0)) return null;
	// 表格里的 TTFT 与 Duration 都显示两位小数；两者在显示上相等时用户看到的就是
	// 「TTFT 占满整个请求」。生成窗口不足 1% 是同一现象在缓冲上游上的表现；不足
	// MIN_GENERATION_WINDOW_MS 则是它在短请求上的表现，两者都属于交付毛刺。
	if (ttft / duration >= 1 - MIN_GENERATION_SHARE_FOR_TPS || ttft.toFixed(2) === duration.toFixed(2)) return null;
	if (generationMs < MIN_GENERATION_WINDOW_MS) return null;
	const tokens = tokenMetrics(log);
	const input = tokens.input / ttft;
	const output = tokens.output >= MIN_OUTPUT_TOKENS_FOR_TPS ? tokens.output / generation : null;
	return {
		input: { value: input, tokens: tokens.input, seconds: ttft },
		output: output === null ? null : { value: output, tokens: tokens.output, seconds: generation },
	};
}
export function durationMs(startTime: string, server: number | null | undefined, now: number): number {
	const start = new Date(startTime).getTime();
	return Number.isFinite(start) ? Math.max(now - start, server ?? 0, 0) : (server ?? 0);
}
/**
 * 首字延迟（TTFT）：请求到达 → 代理首次向客户端写出内容。
 *
 * 非流式请求没有「首帧」这个时刻：后端把整份响应就绪的时间记成完成起始时间，TTFT 因此
 * 必然等于总耗时。这个数字不是首字等待，与 Duration 并排显示只会让人以为请求在首字上卡了
 * 很久，所以按请求的流式开关隐藏，表格显示 `-`。历史行没有流式标记（无法判断）时仍按两个
 * 时间戳计算，不丢弃已经观测到的值。
 * @param log - 日志行
 */
export function ttftMs(log: LogEntry): number | null {
	if (log.stream === false) return null;
	if (!log.completionStartTime) return null;
	const value = new Date(log.completionStartTime).getTime() - new Date(log.startTime).getTime();
	return Number.isFinite(value) && value > 0 ? value : null;
}
export interface ModelResolutionChainEntry {
	fallback_index: number;
	input_model: string;
	resolved_model: string;
	resolution_path: string[];
}
export interface ModelResolutionLine {
	label: string;
	path: string[];
}
export function normalizeModelResolutionChain(value: unknown): ModelResolutionChainEntry[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const data = record(item);
		if (
			typeof data.fallback_index !== "number" ||
			!Number.isInteger(data.fallback_index) ||
			data.fallback_index < 0 ||
			typeof data.input_model !== "string" ||
			typeof data.resolved_model !== "string" ||
			!Array.isArray(data.resolution_path) ||
			data.resolution_path.length <= 1 ||
			!data.resolution_path.every((v: unknown) => typeof v === "string")
		)
			return [];
		return [
			{
				fallback_index: data.fallback_index,
				input_model: data.input_model,
				resolved_model: data.resolved_model,
				resolution_path: [...data.resolution_path] as string[],
			},
		];
	});
}
export function buildModelResolutionLines(fallbackValue: unknown, chainValue: unknown, executed: string): ModelResolutionLine[] {
	const fallbacks = Array.isArray(fallbackValue) ? fallbackValue.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
	const entries = normalizeModelResolutionChain(chainValue).sort((a, b) => a.fallback_index - b.fallback_index);
	const byIndex = new Map(entries.map((entry) => [entry.fallback_index, entry]));
	const max = Math.max(fallbacks.length - 1, ...entries.map((entry) => entry.fallback_index), 0),
		lines: ModelResolutionLine[] = [];
	let previous: string | undefined;
	for (let i = 0; i <= max; i++) {
		const path = byIndex.get(i)?.resolution_path ?? (fallbacks[i] ? [fallbacks[i]] : []);
		if (!path.length) continue;
		const first = path[0];
		lines.push({
			label: i === 0 ? "Request" : "Fallback " + i,
			path: i > 0 && previous && previous !== first ? [previous, first] : [first],
		});
		for (let hop = 1; hop < path.length; hop++) lines.push({ label: "Alias", path: [path[hop - 1], path[hop]] });
		previous = path[path.length - 1];
	}
	if (executed) lines.push({ label: "Executed", path: [executed] });
	return lines;
}
export interface TokenCostBreakdown {
	cacheInputCost?: number;
	inputCost?: number;
	outputCost?: number;
}
function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function tokenCostBreakdown(log: LogEntry): TokenCostBreakdown {
	const b = record(log.metadata?.cost_breakdown),
		inputCost = finite(b.input_cost),
		outputCost = finite(b.output_cost),
		totalCost = finite(b.total_cost);
	let cacheInputCost = finite(b.cache_input_cost);
	if (cacheInputCost === undefined) {
		const read = finite(b.cache_read_input_cost),
			creation = finite(b.cache_creation_input_cost);
		if (read !== undefined || creation !== undefined) cacheInputCost = (read ?? 0) + (creation ?? 0);
	}
	const hasNonToken =
		(finite(b.tool_usage_cost) ?? 0) !== 0 ||
		Object.values(record(b.additional_costs)).some((v) => (finite(v) ?? 0) !== 0) ||
		[b.discount_amount, b.discount_percent, b.margin_fixed_amount, b.margin_percent, b.margin_total_amount, b.original_cost].some(
			(v) => (finite(v) ?? 0) !== 0,
		);
	if (cacheInputCost === undefined && inputCost !== undefined && outputCost !== undefined && totalCost !== undefined && !hasNonToken)
		cacheInputCost = Math.max(0, totalCost - inputCost - outputCost);
	return { cacheInputCost, inputCost, outputCost };
}
