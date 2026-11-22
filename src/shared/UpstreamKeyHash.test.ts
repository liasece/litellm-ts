import { hashUpstreamKey, resolveDirectUpstreamSecret } from "./UpstreamKeyHash";

describe("UpstreamKeyHash", () => {
	it("同一密钥始终得到相同 SHA-256，不同密钥隔离", () => {
		expect(hashUpstreamKey("sk-secret")).toBe(hashUpstreamKey("sk-secret"));
		expect(hashUpstreamKey("sk-secret")).not.toBe(hashUpstreamKey("sk-secret-2"));
		expect(hashUpstreamKey("sk-secret")).toMatch(/^[a-f0-9]{64}$/);
	});

	it("Anthropic 使用实际发送的 auth_token，其它 Provider 使用 api_key", () => {
		expect(resolveDirectUpstreamSecret({ api_key: "api", auth_token: "oauth" }, "anthropic")).toBe("oauth");
		expect(resolveDirectUpstreamSecret({ api_key: "api", auth_token: "oauth" }, "openai")).toBe("api");
		expect(resolveDirectUpstreamSecret({ api_key: "api" }, "anthropic")).toBe("api");
	});

	it("忽略空串和非字符串值，避免把未发送的占位符记成上游 key", () => {
		expect(resolveDirectUpstreamSecret({ api_key: "", auth_token: 42 }, "anthropic")).toBeUndefined();
		expect(resolveDirectUpstreamSecret({ api_key: { value: "nested" } }, "openai")).toBeUndefined();
	});
});
