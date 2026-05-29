/**
 * API 错误类 — 路由处理器中 throw 后由 registerRoute 统一捕获
 */

/** 通用 API 使用的 HTTP 状态码 */
const HTTP_STATUS = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	NOT_FOUND: 404,
	CONFLICT: 409,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_SERVER_ERROR: 500,
	SERVICE_UNAVAILABLE: 503,
} as const;

export { HTTP_STATUS };

/** API 错误实例，携带 HTTP 状态码和面向用户的错误信息 */
export class ApiError extends Error {
	override readonly name = "ApiError";

	/**
	 * @param statusCode - HTTP 状态码（4xx/5xx）
	 * @param message - 面向用户的错误描述（中文）
	 */
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
	}

	/**
	 * 400 Bad Request — 请求参数缺失或格式不合法
	 * @param message - 面向用户的错误描述
	 */
	static badRequest(message: string): ApiError {
		return new ApiError(HTTP_STATUS.BAD_REQUEST, message);
	}

	/**
	 * 401 Unauthorized — 未认证或认证失败
	 * @param message - 面向用户的错误描述
	 */
	static unauthorized(message: string): ApiError {
		return new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
	}

	/**
	 * 404 Not Found — 目标资源不存在
	 * @param message - 面向用户的错误描述
	 */
	static notFound(message: string): ApiError {
		return new ApiError(HTTP_STATUS.NOT_FOUND, message);
	}

	/**
	 * 409 Conflict — 资源冲突（如名称重复、仍被引用）
	 * @param message - 面向用户的错误描述
	 */
	static conflict(message: string): ApiError {
		return new ApiError(HTTP_STATUS.CONFLICT, message);
	}

	/**
	 * 429 Too Many Requests — 请求过多、预算超限等
	 * @param message - 面向用户的错误描述
	 */
	static tooManyRequests(message = "请求过多"): ApiError {
		return new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, message);
	}

	/**
	 * 503 Service Unavailable — 依赖服务未初始化
	 * @param message - 面向用户的错误描述
	 */
	static unavailable(message: string): ApiError {
		return new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, message);
	}
}
