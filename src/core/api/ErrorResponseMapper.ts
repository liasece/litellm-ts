/**
 * ErrorResponseMapper — 将任意异常统一映射为 ApiError
 *
 * 供 registerRoute / registerController / ErrorHandler 共用，消除三处重复的错误分派逻辑。
 *
 * 映射规则（对齐 Python litellm proxy 的异常处理）：
 * - ApiError：原样透传
 * - LitellmError 家族（Router 抛出）：优先取异常自带 status_code（对齐 PY getattr(e, "status_code", 500)，
 *   见 litellm/proxy/common_request_processing.py:1672-1680），缺省时按异常类型映射；
 *   type/param 对齐 PY `getattr(e, "type"/"param", "None")`：
 *   - RouterRateLimitErrorBasic / RouterRateLimitError（PY 为裸 ValueError 子类，无 type/param 属性）
 *     → 字符串 "None"（PY 实测 429 no-deployments 响应 type/param 均为 "None"）
 *   - RateLimitError（PY litellm.RateLimitError 自带 type="throttling_error"，见
 *     litellm/exceptions.py:356；param 属性为 None → JSON null）
 *   - 其余 litellm 异常（openai 派生，type/param 属性为 None）→ JSON null
 * - 其他未知异常：500 internal_server_error（对齐 PY handle_exception_on_proxy）
 */

import { ApiError, HTTP_STATUS, PYTHON_NONE_FILL } from "./ApiError";
import { toErrorMessage } from "../utils/logger";
import {
	AuthenticationError,
	BadRequestError,
	InternalServerError,
	LitellmError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	RouterRateLimitError,
	RouterRateLimitErrorBasic,
	ServiceUnavailableError,
	TimeoutError,
	UnprocessableEntityError,
} from "../../router/RouterErrors";

/**
 * PY litellm.RateLimitError 的 type 属性值（litellm/exceptions.py:356 `self.type = "throttling_error"`）。
 * mock_testing_rate_limit_error / 上游 429 重试耗尽路径实测响应 type 为该值。
 */
const LITELLM_RATE_LIMIT_ERROR_TYPE = "throttling_error";

/**
 * 按 LitellmError 具体类型推断 HTTP 状态码（status_code 字段缺省时的兜底）。
 * 注意子类必须先于父类判断（PermissionDeniedError extends AuthenticationError，
 * UnprocessableEntityError extends BadRequestError）。
 * @param error - Router 抛出的 LitellmError
 */
function inferStatusCodeFromType(error: LitellmError): number {
	if (error instanceof UnprocessableEntityError) {
		return HTTP_STATUS.UNPROCESSABLE_ENTITY;
	}
	if (error instanceof BadRequestError) {
		return HTTP_STATUS.BAD_REQUEST;
	}
	if (error instanceof PermissionDeniedError) {
		return 403;
	}
	if (error instanceof AuthenticationError) {
		return HTTP_STATUS.UNAUTHORIZED;
	}
	if (error instanceof RateLimitError) {
		return HTTP_STATUS.TOO_MANY_REQUESTS;
	}
	if (error instanceof NotFoundError) {
		return HTTP_STATUS.NOT_FOUND;
	}
	if (error instanceof TimeoutError) {
		return 408;
	}
	if (error instanceof ServiceUnavailableError) {
		return HTTP_STATUS.SERVICE_UNAVAILABLE;
	}
	if (error instanceof InternalServerError) {
		return HTTP_STATUS.INTERNAL_SERVER_ERROR;
	}
	return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * 按 PY `getattr(e, "type"/"param", "None")` 语义推断错误体的 type/param。
 * 注意子类必须先于父类判断（RouterRateLimitErrorBasic extends RateLimitError）。
 * @param error - Router 抛出的 LitellmError
 */
function inferTypeParamFromType(error: LitellmError): { type: string | null; param: string | null } {
	// PY RouterRateLimitErrorBasic / RouterRateLimitError 为裸 ValueError 子类，
	// 无 type/param 属性 → getattr 缺省命中字符串 "None"
	if (error instanceof RouterRateLimitErrorBasic || error instanceof RouterRateLimitError) {
		return { type: PYTHON_NONE_FILL, param: PYTHON_NONE_FILL };
	}
	// PY litellm.RateLimitError 自带 type="throttling_error"（exceptions.py:356）；param 为 None → null
	if (error instanceof RateLimitError) {
		return { type: LITELLM_RATE_LIMIT_ERROR_TYPE, param: null };
	}
	// 其余 litellm 异常派生自 openai 异常，type/param 属性值为 None → JSON null
	return { type: null, param: null };
}

/**
 * 将任意异常映射为 ApiError。
 * @param error - 路由处理中抛出的异常
 */
export function mapToApiError(error: unknown): ApiError {
	if (error instanceof ApiError) {
		return error;
	}
	if (error instanceof LitellmError) {
		const statusCode = error.status_code ?? inferStatusCodeFromType(error);
		const { type, param } = inferTypeParamFromType(error);
		return new ApiError(statusCode, error.message, type, param);
	}
	return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, toErrorMessage(error));
}
