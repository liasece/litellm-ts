import type { ProviderRequest } from "../types/provider";

/** 脱敏后可写入详细 SpendLog 的上游请求。 */
export interface UpstreamRequestLog {
	/** 最终请求 URL。 */
	readonly url: string;
	/** HTTP 方法。 */
	readonly method: string;
	/** 已脱敏请求头。 */
	readonly headers: Record<string, string>;
	/** Provider 转换后的 JSON 请求体。 */
	readonly body: unknown;
}

/** 脱敏后可写入详细 SpendLog 的上游响应。 */
export interface UpstreamResponseLog {
	/** 上游 HTTP 状态码。 */
	readonly status_code: number;
	/** 已脱敏响应头。 */
	readonly headers: Record<string, string>;
	/** 已解析的非流式响应体，或流式协议终态事件携带的完整响应对象。 */
	readonly body?: unknown;
}

/** 单次最终 Provider 调用的请求/响应上下文。 */
export interface UpstreamLogContext {
	/** 实际上游请求。 */
	readonly request: UpstreamRequestLog;
	/** 实际上游响应；网络层失败时可能不存在。 */
	readonly response?: UpstreamResponseLog;
}

const UPSTREAM_LOG_CONTEXT = Symbol("litellm.upstreamLogContext");
const SENSITIVE_HEADER_NAMES = new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"api-key",
	"x-litellm-api-key",
	"cookie",
	"set-cookie",
]);

function sanitizeHeaders(headers: Headers | Record<string, string> | undefined): Record<string, string> {
	const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers ?? {});
	return Object.fromEntries(
		entries.map(([name, value]) => [name, SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[REDACTED]" : value]),
	);
}

/**
 * 从 Provider transport 的真实请求/响应构造可持久化的诊断上下文。
 * @param request - Provider 转换后的最终请求
 * @param response - 上游 HTTP 响应
 * @param responseBody - 已解析的非流式上游响应体
 */
export function createUpstreamLogContext(request: ProviderRequest, response?: Response, responseBody?: unknown): UpstreamLogContext {
	return {
		request: {
			url: request.url,
			method: request.method,
			headers: sanitizeHeaders(request.headers),
			body: request.logBody ?? request.body,
		},
		...(response
			? {
					response: {
						status_code: response.status,
						headers: sanitizeHeaders(response.headers),
						...(responseBody !== undefined ? { body: responseBody } : {}),
					},
				}
			: {}),
	};
}

/**
 * 以不可枚举 Symbol 挂载诊断上下文，避免内部请求/响应混入客户端响应或普通错误日志。
 * @template T - 挂载上下文的对象类型
 * @param target - Router 结果或异常对象
 * @param context - 上游请求/响应上下文
 */
export function attachUpstreamLogContext<T extends object>(target: T, context: UpstreamLogContext | undefined): T {
	if (!context) {
		return target;
	}
	Object.defineProperty(target, UPSTREAM_LOG_CONTEXT, {
		value: context,
		configurable: true,
		enumerable: false,
		writable: true,
	});
	return target;
}

/**
 * 从 Router 结果或异常读取不可枚举的上游诊断上下文。
 * @param value - Router 结果或异常
 */
export function getUpstreamLogContext(value: unknown): UpstreamLogContext | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	return (value as { [UPSTREAM_LOG_CONTEXT]?: UpstreamLogContext })[UPSTREAM_LOG_CONTEXT];
}
