import { describe, expect, it } from "@jest/globals";

import { createUpstreamLogContext } from "../router/UpstreamLogContext";
import { buildPassthroughLogRequest } from "./CliProxyUpstreamLogging";

describe("buildPassthroughLogRequest", () => {
	it("构造 ProviderRequest 形状并保留请求要素", () => {
		const headers = new Headers({ "Content-Type": "application/json", Authorization: "Bearer secret" });
		const request = buildPassthroughLogRequest({
			url: "http://127.0.0.1:8317/v1/responses",
			method: "POST",
			headers: headers,
			body: { model: "gpt-5.6-sol", input: "hi" },
			model: "gpt-5.6-sol",
		});
		expect(request.url).toBe("http://127.0.0.1:8317/v1/responses");
		expect(request.method).toBe("POST");
		expect(request.body).toEqual({ model: "gpt-5.6-sol", input: "hi" });
		expect(request.model).toBe("gpt-5.6-sol");
	});

	it("支持 GET 等透传方法", () => {
		const request = buildPassthroughLogRequest({
			url: "http://127.0.0.1:8317/v1beta/models",
			method: "GET",
			headers: new Headers(),
			body: undefined,
		});
		expect(request.method).toBe("GET");
	});

	it("model 缺省为空字符串", () => {
		const request = buildPassthroughLogRequest({
			url: "http://x",
			method: "POST",
			headers: new Headers(),
			body: {},
		});
		expect(request.model).toBe("");
	});

	it("与 createUpstreamLogContext 组合时脱敏请求头", () => {
		const context = createUpstreamLogContext(
			buildPassthroughLogRequest({
				url: "http://x/v1/responses",
				method: "POST",
				headers: new Headers({ Authorization: "Bearer secret", "x-custom": "keep" }),
				body: { a: 1 },
			}),
		);
		expect(context.request.headers["authorization"]).toBe("[REDACTED]");
		expect(context.request.headers["x-custom"]).toBe("keep");
	});

	it("无响应时上下文仅含 request", () => {
		const context = createUpstreamLogContext(
			buildPassthroughLogRequest({ url: "http://x", method: "POST", headers: new Headers(), body: {} }),
		);
		expect(context.response).toBeUndefined();
	});
});
