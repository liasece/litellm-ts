import { attachUpstreamIdentity, getUpstreamIdentity } from "./UpstreamKeyIdentity";

describe("UpstreamKeyIdentity", () => {
	it("身份挂在不可枚举 Symbol 上，不进入 provider 参数序列化", () => {
		const deployment = attachUpstreamIdentity(
			{ litellm_params: { model: "openai/gpt" } },
			{ keyHash: "hash-a", account: { kind: "credential", id: "credential-a", provider: "openai" } },
		);
		expect(getUpstreamIdentity(deployment)).toEqual({
			keyHash: "hash-a",
			account: { kind: "credential", id: "credential-a", provider: "openai" },
		});
		expect(Object.keys(deployment)).toEqual(["litellm_params"]);
		expect(JSON.stringify(deployment)).not.toContain("hash-a");
	});

	it("没有可记录身份时不污染对象", () => {
		const deployment = attachUpstreamIdentity({ litellm_params: {} }, undefined);
		expect(getUpstreamIdentity(deployment)).toBeUndefined();
		expect(Object.getOwnPropertySymbols(deployment)).toEqual([]);
	});
});
