/**
 * API 错误类 — 路由处理器中 throw 后由 registerRoute 统一捕获
 *
 * 错误响应格式对齐 Python litellm ProxyException.to_dict（litellm/proxy/_types.py）：
 *   { "error": { "message": string, "type": string|null, "param": string|null, "code": string } }
 * 其中 code 为 HTTP 状态码的字符串形式（PY 中 str(code)）。
 */

/** 通用 API 使用的 HTTP 状态码 */
const HTTP_STATUS = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	UNPROCESSABLE_ENTITY: 422,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_SERVER_ERROR: 500,
	SERVICE_UNAVAILABLE: 503,
} as const;

export { HTTP_STATUS };

/**
 * PY ProxyException 对无 type/param 属性的异常使用字符串 "None" 作为填充值
 * （getattr(e, "type", "None")，litellm/proxy/common_request_processing.py）。
 * RouterRateLimitError 等 ValueError 系异常序列化后 type/param 均为 "None"。
 */
export const PYTHON_NONE_FILL = "None";

/**
 * 无可用部署错误的上下文信息（对齐 PY RouterRateLimitError 构造参数，
 * litellm/types/router.py:676-689）
 */
export interface NoDeploymentsErrorInfo {
	/** 冷却时长（秒）：组内冷却 deployment 的最小配置 cooldown_time；无冷却条目时为 Router 默认 cooldown_time */
	readonly cooldownSeconds: number;
	/** 当前全部冷却中的 deployment id 列表（PY cooldown_list 为全模型组范围） */
	readonly cooldownList: readonly string[];
	/** Router pre_call_checks 开关状态（PY enable_pre_call_checks） */
	readonly preCallChecks: boolean;
}

/**
 * 构造 Python 风格 "No deployments available" 错误消息。
 * 对齐 PY RouterRateLimitError._message（litellm/types/router.py:688）：
 *   "No deployments available for selected model, Try again in {cooldown} seconds.
 *    Passed model={model}. pre-call-checks={bool}, cooldown_list=[...]"
 * PY 细节：bool 渲染为 True/False；list 以单引号包裹元素；整型秒数不带小数点。
 * @param model - 客户端请求的逻辑模型名
 * @param info - 冷却上下文
 */
export function formatNoDeploymentsAvailableMessage(model: string, info: NoDeploymentsErrorInfo): string {
	const cooldownSeconds = Number.isInteger(info.cooldownSeconds) ? info.cooldownSeconds.toString() : String(info.cooldownSeconds);
	const cooldownList = info.cooldownList.map((deploymentId) => `'${deploymentId}'`).join(", ");
	const preCallChecks = info.preCallChecks ? "True" : "False";
	return (
		`No deployments available for selected model, Try again in ${cooldownSeconds} seconds. ` +
		`Passed model=${model}. pre-call-checks=${preCallChecks}, cooldown_list=[${cooldownList}]`
	);
}

/**
 * FastAPI 422 参数校验错误项（对齐 FastAPI RequestValidationError 响应结构，
 * 供 registerRoute 序列化为 { "detail": [...] }）
 */
export interface ValidationErrorItem {
	/** 出错参数位置（如 ["body", "model"]） */
	readonly loc: readonly (string | number)[];
	/** 校验失败描述 */
	readonly msg: string;
	/** 校验错误类型（如 "missing"、"value_error"） */
	readonly type: string;
}

/** API 错误实例，携带 HTTP 状态码和面向用户的错误信息 */
export class ApiError extends Error {
	override readonly name = "ApiError";
	readonly errorType: string | null;

	/**
	 * 响应体覆盖：设置后 toErrorBody 直接返回该对象（用于 FastAPI 422 detail 等非标准 error 包装）
	 */
	private _bodyOverride?: Record<string, unknown>;

	/**
	 * @param statusCode - HTTP 状态码（4xx/5xx）
	 * @param message - 面向用户的错误描述
	 * @param errorType - 错误类型字符串；undefined 时按状态码推断，显式传 null 则序列化为 null（对齐 PY 行为）
	 * @param param - 关联参数名；缺省序列化为 null
	 */
	constructor(
		readonly statusCode: number,
		message: string,
		errorType?: string | null,
		readonly param: string | null = null,
	) {
		super(message);
		this.errorType = errorType === undefined ? this._defaultErrorType() : errorType;
	}

	/**
	 * 按状态码推断 OpenAI 兼容 error.type
	 */
	private _defaultErrorType(): string {
		switch (this.statusCode) {
			case 400:
				return "invalid_request_error";
			case 401:
				return "invalid_api_key";
			case 403:
				return "permission_denied";
			case 404:
				return "not_found";
			case 409:
				return "conflict";
			case 422:
				return "unprocessable_entity";
			case 429:
				return "rate_limit_error";
			case 503:
				return "service_unavailable";
			default:
				if (this.statusCode >= 500) {
					return "internal_server_error";
				}
				return "api_error";
		}
	}

	/**
	 * 序列化为 Python litellm 风格错误响应体。
	 * 对齐 PY ProxyException.to_dict：{ error: { message, type, param, code } }，code 为字符串。
	 */
	toErrorBody(): Record<string, unknown> {
		if (this._bodyOverride !== undefined) {
			return this._bodyOverride;
		}
		return {
			error: {
				message: this.message,
				type: this.errorType,
				param: this.param,
				code: String(this.statusCode),
			},
		};
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
	 * 403 Forbidden — 已认证但权限不足
	 * @param message - 面向用户的错误描述
	 */
	static forbidden(message: string): ApiError {
		return new ApiError(HTTP_STATUS.FORBIDDEN, message);
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
	 * 429 — 所选模型无可用部署（全部冷却或无配置）。
	 * 对齐 PY RouterRateLimitError 经 ProxyException 序列化的实测响应：
	 * HTTP 429 + { error: { message: "No deployments available for selected model, ...", type: "None", param: "None", code: "429" } }
	 * @param model - 客户端请求的逻辑模型名
	 * @param info - 冷却上下文（见 Router.getNoAvailableDeploymentInfo）
	 */
	static noDeploymentsAvailable(model: string, info: NoDeploymentsErrorInfo): ApiError {
		return new ApiError(
			HTTP_STATUS.TOO_MANY_REQUESTS,
			formatNoDeploymentsAvailableMessage(model, info),
			PYTHON_NONE_FILL,
			PYTHON_NONE_FILL,
		);
	}

	/**
	 * 422 Unprocessable Entity — FastAPI 风格参数校验错误。
	 * 响应体为 { "detail": [{ loc, msg, type }] }（对齐 FastAPI RequestValidationError），
	 * 供缺必填参数等场景使用（PY /config/list、/health/services 等端点的 422 语义）。
	 * @param detail - 校验错误项列表
	 */
	static unprocessableEntity(detail: readonly ValidationErrorItem[]): ApiError {
		const error = new ApiError(HTTP_STATUS.UNPROCESSABLE_ENTITY, detail[0]?.msg ?? "请求参数校验失败");
		error._bodyOverride = { detail: [...detail] };
		return error;
	}

	/**
	 * FastAPI HTTPException 风格错误（响应体 { detail: <任意结构> }）。
	 * 对齐 PY `raise HTTPException(status_code=400, detail={"error": "..."})` 的序列化形式，
	 * 供 /utils/supported_openai_params 等 FastAPI 原生端点使用。
	 * @param statusCode - HTTP 状态码
	 * @param detail - detail 字段内容（对象或字符串）
	 */
	static httpException(statusCode: number, detail: unknown): ApiError {
		const error = new ApiError(statusCode, typeof detail === "string" ? detail : "HTTP Exception");
		error._bodyOverride = { detail: detail };
		return error;
	}

	/**
	 * 503 Service Unavailable — 依赖服务未初始化
	 * @param message - 面向用户的错误描述
	 */
	static unavailable(message: string): ApiError {
		return new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, message);
	}
}
