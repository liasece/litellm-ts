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

	const seen = new Set<string>();
	return collected.filter((error) => {
		if (displayed !== undefined && error.message === displayed) return false;
		const key = `${error.type}|${error.code}|${error.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
