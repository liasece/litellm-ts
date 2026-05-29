/**
 * Router 专属异常类型
 *
 * 对齐 Python litellm/exceptions.py 的异常类层次结构。
 * 用于 _executeWithFallback 中通过 isinstance 检测异常类型替代字符串匹配。
 */

/** API 连接错误（不对 CDN/硬错误走冷却） */
export class APIConnectionError extends Error {
	override readonly name = "APIConnectionError";
	constructor(message: string) {
		super(message);
	}
}

/** 上下文窗口超限错误 */
export class ContextWindowExceededError extends Error {
	override readonly name = "ContextWindowExceededError";
	constructor(message: string) {
		super(message);
	}
}

/** 内容策略违规错误 */
export class ContentPolicyViolationError extends Error {
	override readonly name = "ContentPolicyViolationError";
	constructor(message: string) {
		super(message);
	}
}

/** Rate limit 错误 */
export class RateLimitError extends Error {
	override readonly name = "RateLimitError";
	constructor(message: string) {
		super(message);
	}
}

/** 认证错误：对标 PY openai.AuthenticationError */
export class AuthenticationError extends Error {
	override readonly name = "AuthenticationError";
	constructor(message: string) {
		super(message);
	}
}

/** 400 BadRequest 错误：对标 PY openai.BadRequestError */
export class BadRequestError extends Error {
	override readonly name = "BadRequestError";
	constructor(message: string) {
		super(message);
	}
}

/** 未找到资源错误：对标 PY litellm.NotFoundError */
export class NotFoundError extends Error {
	override readonly name = "NotFoundError";
	constructor(message: string) {
		super(message);
	}
}
