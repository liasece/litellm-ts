import type { LogEntry } from "../support/LogsModels";
import { isInProgressLog } from "./LogsIdentityLogic";
import { modelSupplier } from "../../providers/logic/ProviderIdentityLogic";
export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : undefined;
}
export function cacheTokens(metadata: LogEntry["metadata"], creation = false): number {
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
	const cacheRead = cacheTokens(log.metadata),
		creation = cacheTokens(log.metadata, true);
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
export function outputTps(log: LogEntry): { value: number; duration: number; tokens: number } | "-" | null {
	const tokens = Number(log.completion_tokens || 0);
	if (!Number.isFinite(tokens) || tokens < 20) return null;
	const duration = (new Date(log.endTime || "").getTime() - new Date(log.startTime).getTime()) / 1000;
	return Number.isFinite(duration) && duration > 0 ? { value: tokens / duration, duration, tokens } : "-";
}
export function durationMs(startTime: string, server: number | null | undefined, now: number): number {
	const start = new Date(startTime).getTime();
	return Number.isFinite(start) ? Math.max(now - start, server ?? 0, 0) : (server ?? 0);
}
export function ttftMs(log: LogEntry): number | null {
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
