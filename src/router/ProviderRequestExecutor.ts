import type { ProviderRequest } from "../types/provider";

/** Provider 请求执行选项。 */
export interface ProviderRequestExecutionOptions {
	/** 请求超时（毫秒）；缺省时不设置定时中止。 */
	readonly timeoutMs?: number;
	/** 是否读取 JSON 响应体；流式请求应设为 false。 */
	readonly readJson?: boolean;
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
	const timeoutHandle =
		options.timeoutMs !== undefined
			? setTimeout(() => {
					timedOut = true;
					abortController.abort();
				}, options.timeoutMs)
			: undefined;
	const startedAtMs = Date.now();

	try {
		const response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: JSON.stringify(request.body),
			signal: abortController.signal,
		});
		const body = options.readJson === false ? undefined : await response.json();
		return {
			response: response,
			body: body,
			latencyMs: Date.now() - startedAtMs,
			startedAtMs: startedAtMs,
		};
	} catch (error) {
		if (timedOut) {
			const timeoutError = new Error("Provider request timed out");
			timeoutError.name = "AbortError";
			throw timeoutError;
		}
		throw error;
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}
