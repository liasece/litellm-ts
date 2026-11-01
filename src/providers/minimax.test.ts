/** MiniMax 原生 OpenAI 与 Anthropic 双协议出口测试。 */

import { MiniMaxProvider } from "./MiniMaxProvider";

describe("MiniMaxProvider", () => {
	const provider = new MiniMaxProvider("minimax-key");
	const model = "minimax/MiniMax-M2.7";

	it("收集流式用量时保留其他选项且不改写调用方参数", () => {
		const options = { stream: true, stream_options: { include_usage: false, include_obfuscation: false } };
		const result = provider.transformRequest(model, [{ role: "user", content: "hi" }], options);
		expect((result.body as Record<string, unknown>)["stream_options"]).toEqual({ include_usage: true, include_obfuscation: false });
		expect(options.stream_options).toEqual({ include_usage: false, include_obfuscation: false });
		const nonStreaming = provider.transformRequest(model, [{ role: "user", content: "hi" }], { ...options, stream: false });
		expect((nonStreaming.body as Record<string, unknown>)["stream_options"]).toBeUndefined();
	});

	it("使用官方 OpenAI 兼容端点并剥离 provider 前缀", () => {
		const result = provider.transformRequest(model, [{ role: "user", content: "hi" }], {});

		expect(result.url).toBe("https://api.minimaxi.com/v1/chat/completions");
		expect((result.body as Record<string, unknown>)["model"]).toBe("MiniMax-M2.7");
	});

	it("使用官方 Anthropic 兼容端点、x-api-key 并剥离 provider 前缀", () => {
		const result = provider.transformAnthropicRequest(model, {});

		expect(result.url).toBe("https://api.minimaxi.com/anthropic/v1/messages");
		expect(result.headers["x-api-key"]).toBe("minimax-key");
		expect(result.headers["anthropic-version"]).toBe("2023-06-01");
		expect(result.model).toBe("MiniMax-M2.7");
	});

	it("把 anthropic_api_base 作为完整根地址，支持已有 /v1/messages 的私有代理", () => {
		const result = provider.transformAnthropicRequest(model, {
			api_base: "http://proxy.internal/v1",
			anthropic_api_base: "http://proxy.internal",
		});

		expect(result.url).toBe("http://proxy.internal/v1/messages");
	});
});
