import type { ProviderRequest } from "../types/provider";

/**
 * CLIProxy 透传端点的上游日志请求要素。
 * method 放宽为 string：passthrough 路由含 GET（如 /v1beta/models），
 * 而 ProviderRequest.method 收窄为 "POST" 用于约束 chat transform 实现。
 */
export interface PassthroughLogRequestOptions {
	/** 最终请求 URL。 */
	readonly url: string;
	/** HTTP 方法（透传路由可为 GET 等任意方法）。 */
	readonly method: string;
	/** 已构造的转发请求头。 */
	readonly headers: Headers;
	/** 结构化日志请求体（二进制体应传 logBody 替代表示）。 */
	readonly body: unknown;
	/** 模型名称。 */
	readonly model?: string;
}

/**
 * 由透传 fetch 的请求要素构造 ProviderRequest 形状的日志请求对象。
 * 配合 createUpstreamLogContext 使用，脱敏由后者统一负责。
 * @param options - 透传请求要素
 */
export function buildPassthroughLogRequest(options: PassthroughLogRequestOptions): ProviderRequest {
	return {
		url: options.url,
		// ProviderRequest.method 类型收窄为 "POST"，但 createUpstreamLogContext 仅透传该字段，
		// 透传路由的 GET 等方法在运行时安全。
		method: options.method as ProviderRequest["method"],
		headers: Object.fromEntries(options.headers.entries()),
		body: options.body,
		model: options.model ?? "",
	};
}
