/**
 * ErrorResponseMapper 单元测试
 *
 * 覆盖 mapToApiError 的分派规则：
 * - ApiError 原样透传
 * - LitellmError 家族按类型映射状态码（status_code 字段优先）
 * - 未知异常 → 500 internal_server_error
 */

import { mapToApiError } from "./ErrorResponseMapper";
import { ApiError } from "./ApiError";
import {
	AuthenticationError,
	BadRequestError,
	ContextWindowExceededError,
	InternalServerError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	RouterRateLimitErrorBasic,
	ServiceUnavailableError,
	TimeoutError,
	UnprocessableEntityError,
} from "../../router/RouterErrors";

describe("mapToApiError", () => {
	it("ApiError 原样透传", () => {
		const original = ApiError.conflict("名称重复");
		expect(mapToApiError(original)).toBe(original);
	});

	it("RateLimitError 家族 → 429（含 RouterRateLimitErrorBasic）", () => {
		expect(mapToApiError(new RateLimitError("rate limit")).statusCode).toBe(429);
		expect(mapToApiError(new RouterRateLimitErrorBasic("No deployments available for selected model, ...")).statusCode).toBe(429);
	});

	it("BadRequestError 家族 → 400，UnprocessableEntityError → 422", () => {
		expect(mapToApiError(new BadRequestError("bad")).statusCode).toBe(400);
		expect(mapToApiError(new ContextWindowExceededError("cw")).statusCode).toBe(400);
		expect(mapToApiError(new UnprocessableEntityError("invalid")).statusCode).toBe(422);
	});

	it("AuthenticationError → 401，PermissionDeniedError → 403", () => {
		expect(mapToApiError(new AuthenticationError("auth")).statusCode).toBe(401);
		expect(mapToApiError(new PermissionDeniedError("denied")).statusCode).toBe(403);
	});

	it("NotFoundError → 404，TimeoutError → 408", () => {
		expect(mapToApiError(new NotFoundError("nf")).statusCode).toBe(404);
		expect(mapToApiError(new TimeoutError("timeout")).statusCode).toBe(408);
	});

	it("ServiceUnavailableError → 503，InternalServerError → 500", () => {
		expect(mapToApiError(new ServiceUnavailableError("unavailable")).statusCode).toBe(503);
		expect(mapToApiError(new InternalServerError("boom")).statusCode).toBe(500);
	});

	it("LitellmError 自带 status_code 时优先使用（对齐 PY getattr(e, 'status_code', 500)）", () => {
		const error = new BadRequestError("provider error", {
			status_code: 418,
		});
		expect(mapToApiError(error).statusCode).toBe(418);
	});

	it("LitellmError 映射后 type/param 对齐 PY getattr(e, 'type'/'param', 'None')", () => {
		// PY litellm.RateLimitError 自带 type="throttling_error"（exceptions.py:356），param 为 None → null
		const body = mapToApiError(new RateLimitError("rate limit")).toErrorBody();
		expect(body).toEqual({ error: { message: "rate limit", type: "throttling_error", param: null, code: "429" } });
	});

	it('RouterRateLimitErrorBasic（PY 裸 ValueError 子类）映射后 type/param 为字符串 "None"', () => {
		const body = mapToApiError(new RouterRateLimitErrorBasic("No deployments available for selected model, ...")).toErrorBody();
		expect(body).toEqual({
			error: { message: "No deployments available for selected model, ...", type: "None", param: "None", code: "429" },
		});
	});

	it("其余 openai 派生 litellm 异常 type/param 为 null（PY 属性值为 None → JSON null）", () => {
		const body = mapToApiError(new BadRequestError("bad request")).toErrorBody();
		expect(body).toEqual({ error: { message: "bad request", type: null, param: null, code: "400" } });
	});

	it("未知 Error → 500 internal_server_error", () => {
		const body = mapToApiError(new Error("unexpected")).toErrorBody();
		expect(body).toEqual({ error: { message: "unexpected", type: "internal_server_error", param: null, code: "500" } });
	});

	it("非 Error 异常 → 500，message 为字符串化值", () => {
		expect(mapToApiError("string error").statusCode).toBe(500);
		expect((mapToApiError("string error").toErrorBody().error as { message: string }).message).toBe("string error");
	});
});
