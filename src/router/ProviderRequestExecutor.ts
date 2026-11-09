import { decodeUndecodeableResponse, sanitizeUpstreamRequestHeaders } from "../core/api/upstreamHeaders";
import type { ProviderRequest } from "../types/provider";
import { TimeoutError } from "./RouterErrors";
import { beginUpstreamAttempt, endUpstreamAttempt, noteUpstreamHeaders, noteUpstreamPayload } from "../observability/RequestTrace";

/** Provider 请求执行选项。 */
export interface ProviderRequestExecutionOptions {
	/** 请求超时（毫秒）；缺省时不设置定时中止。 */
	readonly timeoutMs?: number;
	/** 是否读取 JSON 响应体；false 时成功流保持未读，但非 2xx 响应仍读取错误体。 */
	readonly readJson?: boolean;
	/** 调用方取消信号；与 provider timeout 任一触发都会中止上游请求。 */
	readonly signal?: AbortSignal;
}

/** Provider 请求执行结果。 */
export interface ProviderRequestExecutionResult {
	/**
	 *
	 */
	readonly response: Response;
	/**
	 *
	 */
	readonly body?: unknown;
	/**
	 *
	 */
	readonly latencyMs: number;
	/**
	 *
	 */
	readonly startedAtMs: number;
}

/**
 * 读取中止信号携带的原因，用于区分客户端断开、上层取消等来源。
 * @param signal - 已中止的调用方信号
 */
function describeAbortReason(signal: AbortSignal): string {
	const reason = signal.reason as unknown;
	if (typeof reason === "string" && reason.length > 0) {
		return reason;
	}
	if (typeof reason === "object" && reason !== null) {
		// DOMException 在 Node 中不是 Error 实例，只能按结构取 message。
		const message = (reason as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) {
			return message;
		}
	}
	return "调用方中止了上游请求";
}

/**
 * 把裸 AbortError 转换成带来源与上游地址的错误，供 SpendLog 直接展示。
 * @param signal - 触发中止的调用方信号
 * @param url - 上游请求地址
 * @param cause - fetch 抛出的原始错误
 */
export function createUpstreamAbortError(signal: AbortSignal, url: string, cause: unknown): DOMException {
	const error = new DOMException(`上游请求已取消：${describeAbortReason(signal)}（${url}）`, "AbortError") as DOMException & {
		stage?: string;
		cause?: unknown;
	};
	error.stage = "upstream_request";
	error.cause = cause;
	return error;
}

/**
 * 判断错误是否为"调用方主动中止"（客户端断开/上层取消）而非服务端故障。
 *
 * 这类错误会沿链路上抛，但语义是"请求方不要了"，不属于本服务的逻辑错误；
 * 日志应按 info 记录，避免把取消刷成告警。
 * @param error - 待判定的错误
 */
export function isClientAbortError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const candidate = error as { name?: unknown; stage?: unknown };
	// createUpstreamAbortError 会额外打 stage，其他路径只看 name。
	return candidate.name === "AbortError";
}

/**
 * 把 executeProviderRequest 已经解析的上游错误体还原成可读文本。
 *
 * 非 2xx 时 executor 在 readJson:false 分支里已消费 Response 流并把结果放在
 * `execution.body`：JSON 可解析时是对象，否则是原始字符串，空响应则为 undefined。
 * 调用方必须用它而不是再次读取 `execution.response`，否则二次读流会抛
 * "Body has already been read" 并被 catch 吞成空字符串，上游错误正文全部丢失。
 * @param body - executeProviderRequest 返回的已解析错误体
 * @returns 可写入日志/错误消息的文本；无正文时为空字符串
 */
export function describeUpstreamErrorBody(body: unknown): string {
	if (body === undefined || body === null) {
		return "";
	}
	if (typeof body === "string") {
		return body;
	}
	try {
		return JSON.stringify(body);
	} catch {
		return String(body);
	}
}

/**
 * 执行已经由 Provider 转换完成的 HTTP 请求。
 * 不处理状态码、重试、fallback、cooldown、SpendLog 或流式解析。
 * @param request - Provider 转换后的请求
 * @param options - transport 选项
 */
export async function executeProviderRequest(
	request: ProviderRequest,
	options: ProviderRequestExecutionOptions = {},
): Promise<ProviderRequestExecutionResult> {
	const abortController = new AbortController();
	let timedOut = false;
	// Fetch retains this signal while reading the response body after headers arrive.
	const signal = options.signal ? AbortSignal.any([abortController.signal, options.signal]) : abortController.signal;
	const timeoutHandle =
		options.timeoutMs !== undefined
			? setTimeout(() => {
					timedOut = true;
					abortController.abort();
				}, options.timeoutMs)
			: undefined;
	const startedAtMs = Date.now();
	// 上游尝试登记到请求轨迹：等待响应头、首个内容与失败都会落到同一段时间轴上。
	const attempt = beginUpstreamAttempt(request.url);

	try {
		const upstreamResponse = await fetch(request.url, {
			method: request.method,
			// 删除 Accept-Encoding：undici 只自动解码 gzip/deflate/br，若按调用方声明协商到
			// zstd，SSE/JSON 会以压缩字节返回，解析失败后只剩 "This operation was aborted"。
			headers: sanitizeUpstreamRequestHeaders(request.headers),
			body: request.bodyEncoding === "raw" ? (request.body as never) : JSON.stringify(request.body),
			signal: signal,
		});
		// 兜底：上游仍返回 undici 不支持的编码时在此解码，保证调用方读到明文。
		const response = decodeUndecodeableResponse(upstreamResponse);
		noteUpstreamHeaders(attempt, response.status);
		let body: unknown;
		if (options.readJson === false) {
			if (!response.ok) {
				const text = await response.text();
				try {
					body = JSON.parse(text) as unknown;
				} catch {
					body = text;
				}
			}
		} else {
			body = await response.json();
		}
		if (options.readJson !== false) {
			// 流式请求此刻只拿到响应头，响应体由调用方继续消费，不能在这里记「读完」。
			noteUpstreamPayload(attempt);
		}
		endUpstreamAttempt(attempt, response.ok ? "ok" : "error");
		return {
			response: response,
			body: body,
			latencyMs: Date.now() - startedAtMs,
			startedAtMs: startedAtMs,
		};
	} catch (error) {
		endUpstreamAttempt(attempt, "error");
		if (timedOut) {
			throw new TimeoutError(`Provider request timed out after ${options.timeoutMs}ms (${request.url})`);
		}
		// 调用方取消时补上来源与上游地址，避免 SpendLog 只记录裸 AbortError 文案。
		if (options.signal?.aborted && (error as { name?: string }).name === "AbortError") {
			throw createUpstreamAbortError(options.signal, request.url, error);
		}
		throw error;
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}
