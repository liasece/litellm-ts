/**
 * Provider 错误类 — 对齐 Python 异常类型体系
 *
 * 用于在 provider 层面抛出特定错误，替代字符串匹配检测。
 * Python 通过 isinstance(e, ContextWindowExceededError) 检测，
 * TS 通过 instanceof ProviderError 检测。
 */

/** 上下文窗口溢出错误 */
export class ContextWindowExceededError extends Error {
	override readonly name = "ContextWindowExceededError";

	constructor(message?: string) {
		super(message ?? "Context window exceeded");
	}
}

/** 内容策略违规错误 */
export class ContentPolicyViolationError extends Error {
	override readonly name = "ContentPolicyViolationError";

	constructor(message?: string) {
		super(message ?? "Content policy violation");
	}
}

/** 速率限制错误（非 HTTP 429 场景，如本地限流检测） */
export class RateLimitError extends Error {
	override readonly name = "RateLimitError";

	constructor(message?: string) {
		super(message ?? "Rate limit error");
	}
}

/** 内部服务器错误 */
export class InternalServerError extends Error {
	override readonly name = "InternalServerError";

	constructor(message?: string) {
		super(message ?? "Internal server error");
	}
}

/** 认证错误 */
export class AuthenticationError extends Error {
	override readonly name = "AuthenticationError";

	constructor(message?: string) {
		super(message ?? "Authentication error");
	}
}

/** 请求超时错误 */
export class TimeoutError extends Error {
	override readonly name = "TimeoutError";

	constructor(message?: string) {
		super(message ?? "Request timeout");
	}
}
