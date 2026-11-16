import { ApiError } from "./ApiError";
import { classifyClientError } from "./ClientErrorCode";
import {
	BadRequestError,
	ContextWindowExceededError,
	InternalServerError,
	RateLimitError,
	RouterRateLimitErrorBasic,
} from "../../router/RouterErrors";

describe("classifyClientError 客户端可见错误分类", () => {
	it("路由限流异常归类为可重试的 rate_limit_exceeded", () => {
		// 生产案例：上游 429 经 pre_call_checks 变成 RouterRateLimitErrorBasic，
		// 流式路径若压成 server_error，下游不会按限流退避重试。
		const error = new RouterRateLimitErrorBasic("No deployments available for selected model", { status_code: 429 });
		expect(classifyClientError(error)).toEqual({
			status: 429,
			code: "rate_limit_exceeded",
			openAiType: "rate_limit_error",
			anthropicType: "rate_limit_error",
		});
	});

	it("RateLimitError 家族缺省状态码时仍按 429 分类", () => {
		// status_code 缺省是 Router 的常态，分类必须回退到异常类型推断而不是 500。
		expect(classifyClientError(new RateLimitError("rate limited")).status).toBe(429);
		expect(classifyClientError(new RateLimitError("rate limited")).code).toBe("rate_limit_exceeded");
	});

	it("上下文超限优先归类为 context_length_exceeded", () => {
		// 400 的细分：下游据该码做截断重试，归成通用 400 会丢掉可行动信息。
		expect(classifyClientError(new ContextWindowExceededError("too long"))).toEqual({
			status: 400,
			code: "context_length_exceeded",
			openAiType: "invalid_request_error",
			anthropicType: "invalid_request_error",
		});
	});

	it("请求错误与鉴权错误按状态码细分", () => {
		expect(classifyClientError(new BadRequestError("bad")).code).toBe("invalid_request_error");
		expect(classifyClientError(new ApiError(401, "no auth")).code).toBe("authentication_error");
		expect(classifyClientError(new ApiError(403, "denied")).code).toBe("permission_denied");
		expect(classifyClientError(new ApiError(404, "missing")).code).toBe("not_found");
	});

	it("服务端错误与未知异常保持 server_error", () => {
		expect(classifyClientError(new InternalServerError("boom")).code).toBe("server_error");
		expect(classifyClientError(new Error("unexpected")).code).toBe("server_error");
	});

	it("Anthropic 协议使用其自身的错误类型取值", () => {
		expect(classifyClientError(new ApiError(429, "slow down")).anthropicType).toBe("rate_limit_error");
		expect(classifyClientError(new ApiError(403, "denied")).anthropicType).toBe("permission_error");
		expect(classifyClientError(new InternalServerError("boom")).anthropicType).toBe("api_error");
	});
});
