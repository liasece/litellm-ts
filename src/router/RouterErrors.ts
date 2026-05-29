/**
 * Router 专属异常类型
 *
 * 对齐 Python litellm/exceptions.py 的异常类层次结构。
 * 用于 _executeWithFallback 中通过 isinstance 检测异常类型替代字符串匹配。
 *
 * GAP: PY 异常树 (litellm/exceptions.py)：
 *   - RateLimitError → openai.RateLimitError
 *   - ContextWindowExceededError → BadRequestError
 *   - ContentPolicyViolationError → BadRequestError
 *   - AuthenticationError → openai.AuthenticationError
 *   - Timeout → openai.APITimeoutError
 *   - NotFoundError → openai.NotFoundError
 *   - APIConnectionError → openai.APIConnectionError
 *
 * TS 现以 extends 链表达这种继承关系（ContextWindowExceededError extends BadRequestError 等），
 * 修复了"类继承结构断了 isinstance 多态"的问题。
 *
 * 标准字段（model/llm_provider/status_code/litellm_response_headers/num_retries/response）
 * 现加入构造器签名，使 `_extractRetryAfterFromError` 等可通过 e.response.headers 访问。
 */

/** 异常通用基础接口：对齐 PY litellm 异常字段 */
// eslint-disable @typescript-eslint/naming-convention

/**
 *
 */
export interface LitellmErrorFields {
	/** 关联模型名 */
	model?: string;
	/** LLM provider 标识 */
	llm_provider?: string;
	/** HTTP 状态码 */
	status_code?: number;
	/** 来自上游响应的 headers (httpx.Headers) */
	litellm_response_headers?: Record<string, string>;
	/** 实际已重试次数 */
	num_retries?: number;
	/** 配置最大重试次数 */
	max_retries?: number;
	/** 上游响应对象（httpx.Response 模拟） */
	response?: {
		/**  */
		headers?: Record<string, string>;
		/**  */
		status_code?: number;
	};
	/** DIFF-RT-02: 整个部署组最短冷却剩余时间（毫秒） */

	/**
	 *
	 */
	cooldown_time?: number;
	/** DIFF-RT-04: 当前活跃冷却部署列表（已 SensitiveDataMasker 处理） */

	/**
	 *
	 */
	cooldown_list?: Array<[string, string]>;
	/** DIFF-RT-05: 请求的模型组名，对齐 PY `router.py:5935-5964 extra_info.requested_model` */

	/**
	 *
	 */
	requested_model?: string;
}

// eslint-enable @typescript-eslint/naming-convention

/** 基础 litellm 异常类：所有 Router 异常继承自此类 */
export class LitellmError extends Error implements LitellmErrorFields {
	override readonly name: string;

	model?: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention, camelcase
	llm_provider?: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	status_code?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention, camelcase
	litellm_response_headers?: Record<string, string>;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	num_retries?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	max_retries?: number;
	response?: { headers?: Record<string, string>; status_code?: number };
	/** DIFF-RT-02: 整个部署组最短冷却剩余时间（毫秒） */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	cooldown_time?: number;
	/** DIFF-RT-04: 当前活跃冷却部署列表（已 SensitiveDataMasker 处理） */
	// eslint-disable-next-line @typescript-eslint/naming-convention, camelcase
	cooldown_list?: Array<[string, string]>;
	/** DIFF-RT-05: 请求的模型组名，对齐 PY `router.py:5935-5964 extra_info.requested_model` */
	// eslint-disable-next-line @typescript-eslint/naming-convention, camelcase
	requested_model?: string;
	constructor(message: string, fields: LitellmErrorFields = {}, errorName = "LitellmError") {
		super(message);
		this.name = errorName;

		this.model = fields.model;
		// eslint-disable-next-line camelcase
		this.llm_provider = fields.llm_provider;

		this.status_code = fields.status_code;
		// eslint-disable-next-line camelcase
		this.litellm_response_headers = fields.litellm_response_headers;

		this.num_retries = fields.num_retries;

		this.max_retries = fields.max_retries;
		this.response = fields.response;

		this.cooldown_time = fields.cooldown_time;
		// eslint-disable-next-line camelcase
		this.cooldown_list = fields.cooldown_list;
		// eslint-disable-next-line camelcase
		this.requested_model = fields.requested_model;
	}
}

/** 400 BadRequest 错误：对标 PY openai.BadRequestError */
export class BadRequestError extends LitellmError {
	override readonly name: string = "BadRequestError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "BadRequestError");
	}
}

/** 上下文窗口超限错误（PY: 继承 BadRequestError） */
export class ContextWindowExceededError extends BadRequestError {
	override readonly name: string = "ContextWindowExceededError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		// 子类覆盖父类 name
		Object.defineProperty(this, "name", { value: "ContextWindowExceededError", configurable: true });
	}
}

/** 内容策略违规错误（PY: 继承 BadRequestError） */
export class ContentPolicyViolationError extends BadRequestError {
	override readonly name: string = "ContentPolicyViolationError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		Object.defineProperty(this, "name", { value: "ContentPolicyViolationError", configurable: true });
	}
}

/** Rate limit 错误（PY: 继承 openai.RateLimitError） */
export class RateLimitError extends LitellmError {
	override readonly name: string = "RateLimitError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "RateLimitError");
	}
}

/** 认证错误：对标 PY openai.AuthenticationError */
export class AuthenticationError extends LitellmError {
	override readonly name: string = "AuthenticationError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "AuthenticationError");
	}
}

/** 未找到资源错误：对标 PY litellm.NotFoundError */
export class NotFoundError extends LitellmError {
	override readonly name: string = "NotFoundError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "NotFoundError");
	}
}

/** 超时错误：对标 PY litellm.Timeout（继承 openai.APITimeoutError） */
export class TimeoutError extends LitellmError {
	override readonly name: string = "TimeoutError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "TimeoutError");
	}
}

/** API 连接错误（不对 CDN/硬错误走冷却） */
export class APIConnectionError extends LitellmError {
	override readonly name: string = "APIConnectionError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "APIConnectionError");
	}
}

/** 5xx 内部服务错误：新增以支持 5xx 分类（litellm.exceptions.InternalServerError） */
export class InternalServerError extends LitellmError {
	override readonly name: string = "InternalServerError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "InternalServerError");
	}
}

/** 权限拒绝错误：新增以支持 403 分类（litellm.exceptions.PermissionDeniedError） */
export class PermissionDeniedError extends AuthenticationError {
	override readonly name: string = "PermissionDeniedError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		Object.defineProperty(this, "name", { value: "PermissionDeniedError", configurable: true });
	}
}

/** 服务不可用错误：新增以支持 503 分类（litellm.exceptions.ServiceUnavailableError） */
export class ServiceUnavailableError extends LitellmError {
	override readonly name: string = "ServiceUnavailableError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields, "ServiceUnavailableError");
	}
}

/** 不可处理实体错误：新增以支持 422 分类 */
export class UnprocessableEntityError extends BadRequestError {
	override readonly name: string = "UnprocessableEntityError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		Object.defineProperty(this, "name", { value: "UnprocessableEntityError", configurable: true });
	}
}

/** Router 预检限流错误：用于 pre_call_checks 失败时 raise（PY router.py:5775） */
export class RouterRateLimitErrorBasic extends RateLimitError {
	override readonly name: string = "RouterRateLimitErrorBasic";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		Object.defineProperty(this, "name", { value: "RouterRateLimitErrorBasic", configurable: true });
	}
}

/** Router 整体限流错误：用于 routing strategy 失败时 raise（PY router.py:9451） */
export class RouterRateLimitError extends RateLimitError {
	override readonly name: string = "RouterRateLimitError";
	constructor(message: string, fields: LitellmErrorFields = {}) {
		super(message, fields);
		Object.defineProperty(this, "name", { value: "RouterRateLimitError", configurable: true });
	}
}

/** DIFF-RT-04: 同步入口已移除错误（饿死事件循环风险） */
export class RouterCompletionSyncRemovedError extends Error {
	override readonly name: string = "RouterCompletionSyncRemovedError";
	constructor(message: string) {
		super(message);
		Object.defineProperty(this, "name", { value: "RouterCompletionSyncRemovedError", configurable: true });
	}
}
