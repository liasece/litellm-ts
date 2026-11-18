import type { LogEntry } from "../support/LogsModels";
import { formatData } from "./LogDetailsDisplayLogic";
import { asRecord } from "./PrettyMessagesBlocksLogic";

/** 日志详情里「显示的错误」下方的一条上游错误。 */
export interface UpstreamErrorView {
	/** 发生位置，例如 `Upstream 2` 或 `Fallback 1` */
	readonly label: string;
	/** 上游返回的错误类别 */
	readonly type: string;
	/** HTTP 状态码或供应商错误码 */
	readonly code: string | null;
	/** 上游错误文案 */
	readonly message: string;
	/** 发出该请求的上游地址，未知时为 null */
	readonly url: string | null;
	/** 补充说明（冷却原因条目用它标注冷却时长与起点） */
	readonly detail?: string;
	/**
	 * 条目来源：`upstream` 表示本次请求与上游的交换，`cooldown` 表示更早的、把部署
	 * 打入冷却的那次上游错误。冷却短路请求没有自己的上游错误，只能展示这条线索。
	 */
	readonly kind?: "upstream" | "cooldown";
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function errorCode(value: unknown): string | null {
	if (typeof value === "number" || typeof value === "string") return String(value);
	return null;
}

/**
 * 从一次上游响应里取出错误摘要；升级前写入的历史日志没有独立的 upstream_errors，
 * 只能从 proxy_server_request.upstream_response 的原文补齐。
 */
function fromUpstreamResponse(log: LogEntry): UpstreamErrorView | null {
	const proxy = asRecord(formatData(log.proxy_server_request));
	const response = asRecord(proxy?.["upstream_response"] ?? proxy?.["upstreamResponse"]);
	if (!response) return null;
	const body = asRecord(formatData(response["body"]));
	const rawError = body?.["error"];
	const error = asRecord(rawError);
	const code = error?.["code"];
	const message =
		text(error?.["message"]) ??
		text(rawError) ??
		text(error?.["error_message"]) ??
		text(asRecord(error?.["error"])?.["message"]) ??
		text(body?.["message"]);
	if (!message) return null;
	return {
		label: "Upstream response",
		type: text(error?.["type"]) ?? (typeof code === "string" || typeof code === "number" ? String(code) : "upstream_error"),
		code: errorCode(error?.["code"] ?? response["status_code"]),
		message: message,
		url: null,
	};
}

/** 历史日志里逐跳 fallback 的错误摘要，按 fallback 顺序排列。 */
function fromRoutingTrace(log: LogEntry): UpstreamErrorView[] {
	const metadata = asRecord(log.metadata) ?? {};
	const rawTrace = metadata["routing_trace"];
	const trace = Array.isArray(rawTrace) ? rawTrace : [];
	return trace.flatMap((raw) => {
		const hop = asRecord(raw);
		const error = asRecord(hop?.["error_information"]);
		const message = text(error?.["error_message"]);
		if (!hop || !error || !message) return [];
		const index = typeof hop["fallback_index"] === "number" ? hop["fallback_index"] : 0;
		const attempted = text(hop["attempted_deployment"]);
		return [
			{
				label: `Fallback ${index}${attempted ? " · " + attempted : ""}`,
				type: text(error["error_type"]) ?? "upstream_error",
				code: errorCode(error["error_code"]),
				message: message,
				url: null,
			},
		];
	});
}

/**
 * 冷却短路时随失败日志落下的诊断：是谁、因为什么错误、被冷却了多久。
 *
 * 这类请求在预检阶段就被拦下，没有自己的上游交换；日志里只留 router 的
 * "No deployments available" 会让人无从判断原因，所以把上游状态码与原文一并列出。
 * @param metadata - 日志 metadata
 */
function fromCooldownContext(metadata: Record<string, unknown>): UpstreamErrorView[] {
	const info = asRecord(metadata["error_information"]);
	const raw = info?.["cooldown_context"];
	if (!Array.isArray(raw)) return [];
	const views: UpstreamErrorView[] = [];
	for (const item of raw) {
		const entry = asRecord(item);
		const message = text(entry?.["error_message"]);
		if (!entry || !message) continue;
		const seconds = typeof entry["cooldown_seconds"] === "number" ? entry["cooldown_seconds"] : 0;
		const startedAt = text(entry["started_at"]);
		const detail = [seconds > 0 ? `${seconds}s cooldown` : "", startedAt ? `started ${startedAt}` : ""].filter(Boolean).join(" · ");
		views.push({
			label: "Cooldown cause",
			type: "cooldown",
			code: errorCode(entry["status_code"]),
			message: message,
			url: null,
			...(detail ? { detail } : {}),
			kind: "cooldown",
		});
	}
	return views;
}

/**
 * 收集一次请求里全部上游错误，按发生顺序去重，供日志详情在最终显示的错误下方逐条列出。
 *
 * 新日志以后端累积的 `metadata.upstream_errors` 为准：它不受「记录上游详情」开关影响，
 * 且保留重试与 fallback 途中的每一次错误。历史日志没有这个字段时，才退回上游响应原文
 * 与逐跳 fallback 轨迹。客户端已经看到的最终错误文案不重复列出。
 * @param log - 详情抽屉中的日志
 */
export function upstreamErrorViews(log: LogEntry): UpstreamErrorView[] {
	const metadata = asRecord(log.metadata) ?? {};
	const displayed = text(asRecord(metadata["error_information"])?.["error_message"]);
	const collected: UpstreamErrorView[] = [];
	const persisted = metadata["upstream_errors"];

	if (Array.isArray(persisted) && persisted.length > 0) {
		persisted.forEach((raw, index) => {
			const error = asRecord(raw);
			const message = text(error?.["message"]);
			if (!error || !message) return;
			collected.push({
				label: `Upstream ${index + 1}`,
				type: text(error["type"]) ?? "upstream_error",
				code: errorCode(error["status_code"] ?? error["code"]),
				message: message,
				url: text(error["url"]) ?? null,
			});
		});
	} else {
		const upstream = fromUpstreamResponse(log);
		if (upstream) collected.push(upstream);
		collected.push(...fromRoutingTrace(log));
	}

	// 冷却原因优先展示：它是解释最终 429 的唯一线索。
	const seen = new Set<string>();
	return [...fromCooldownContext(metadata), ...collected].filter((error) => {
		if (displayed !== undefined && error.message === displayed) return false;
		const key = `${error.type}|${error.code}|${error.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
