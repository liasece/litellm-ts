/**
 * ApiError 单元测试
 *
 * 覆盖：
 * - toErrorBody 序列化为 Python litellm ProxyException 风格 { error: { message, type, param, code } }
 * - noDeploymentsAvailable 工厂：HTTP 429 + PY RouterRateLimitError 消息格式
 * - unprocessableEntity 工厂：FastAPI 风格 { detail: [...] }
 * - formatNoDeploymentsAvailableMessage 的 Python 渲染细节（True/False、单引号列表、整型秒数）
 */

import { ApiError, formatNoDeploymentsAvailableMessage } from "./ApiError";

describe("ApiError.toErrorBody", () => {
	it("序列化为 { error: { message, type, param, code } }，code 为状态码字符串", () => {
		const body = ApiError.badRequest("model 字段缺失").toErrorBody();
		expect(body).toEqual({
			error: {
				message: "model 字段缺失",
				type: "invalid_request_error",
				param: null,
				code: "400",
			},
		});
	});

	it("按状态码推断默认 errorType", () => {
		expect((ApiError.unauthorized("x").toErrorBody().error as { type: string }).type).toBe("invalid_api_key");
		expect((ApiError.notFound("x").toErrorBody().error as { type: string }).type).toBe("not_found");
		expect((ApiError.conflict("x").toErrorBody().error as { type: string }).type).toBe("conflict");
		expect((ApiError.tooManyRequests("x").toErrorBody().error as { type: string }).type).toBe("rate_limit_error");
		expect((ApiError.unavailable("x").toErrorBody().error as { type: string }).type).toBe("service_unavailable");
	});

	it("显式传入 type/param 时按传入值序列化", () => {
		const body = new ApiError(400, "bad", "custom_type", "custom_param").toErrorBody();
		expect(body).toEqual({ error: { message: "bad", type: "custom_type", param: "custom_param", code: "400" } });
	});

	it("显式传 null type 时序列化为 null（对齐 PY litellm 异常 type=None）", () => {
		const body = new ApiError(429, "rate limited", null, null).toErrorBody();
		expect(body).toEqual({ error: { message: "rate limited", type: null, param: null, code: "429" } });
	});
});

describe("formatNoDeploymentsAvailableMessage", () => {
	it("整型秒数不带小数点，bool 渲染为 True，冷却列表单引号包裹", () => {
		const message = formatNoDeploymentsAvailableMessage("hy3", {
			cooldownSeconds: 300,
			cooldownList: ["29787015fa549cd6"],
			preCallChecks: true,
		});
		expect(message).toBe(
			"No deployments available for selected model, Try again in 300 seconds. " +
				"Passed model=hy3. pre-call-checks=True, cooldown_list=['29787015fa549cd6']",
		);
	});

	it("preCallChecks=false 渲染为 False，空冷却列表渲染为 []", () => {
		const message = formatNoDeploymentsAvailableMessage("gpt-4", {
			cooldownSeconds: 5,
			cooldownList: [],
			preCallChecks: false,
		});
		expect(message).toBe(
			"No deployments available for selected model, Try again in 5 seconds. Passed model=gpt-4. pre-call-checks=False, cooldown_list=[]",
		);
	});

	it("多个冷却 deployment 以 ', ' 分隔", () => {
		const message = formatNoDeploymentsAvailableMessage("m", {
			cooldownSeconds: 60,
			cooldownList: ["id-a", "id-b"],
			preCallChecks: false,
		});
		expect(message).toContain("cooldown_list=['id-a', 'id-b']");
	});
});

describe("ApiError.noDeploymentsAvailable", () => {
	it('HTTP 429 + type/param 为字符串 "None"（对齐 PY 实测响应）', () => {
		const error = ApiError.noDeploymentsAvailable("hy3", {
			cooldownSeconds: 300,
			cooldownList: ["29787015fa549cd6"],
			preCallChecks: true,
		});
		expect(error.statusCode).toBe(429);
		expect(error.toErrorBody()).toEqual({
			error: {
				message:
					"No deployments available for selected model, Try again in 300 seconds. " +
					"Passed model=hy3. pre-call-checks=True, cooldown_list=['29787015fa549cd6']",
				type: "None",
				param: "None",
				code: "429",
			},
		});
	});
});

describe("ApiError.unprocessableEntity", () => {
	it("HTTP 422 + FastAPI 风格 { detail: [{ loc, msg, type }] }", () => {
		const error = ApiError.unprocessableEntity([{ loc: ["query", "budget_id"], msg: "field required", type: "missing" }]);
		expect(error.statusCode).toBe(422);
		expect(error.toErrorBody()).toEqual({
			detail: [{ loc: ["query", "budget_id"], msg: "field required", type: "missing" }],
		});
	});
});
