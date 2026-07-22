import { LLMuxProvider } from "./LLMuxProvider";
import type { Message } from "../types/openai";

describe("LLMuxProvider", () => {
	const provider = new LLMuxProvider();
	const defaultApiBase = "http://192.168.1.220:18182";

	describe("transformRequest", () => {
		it("路由到 llmux endpoint (port 18182)", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-sonnet-4-6", messages, {
				api_key: "llmux-key",
			});

			expect(result.url).toContain("192.168.1.220:18182");
			expect(result.url).toContain("/v1/messages");
			expect(result.method).toBe("POST");
		});

		it("传递 llmux auth token (x-api-key)", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-sonnet-4-6", messages, {
				api_key: "llmux-secret",
			});

			expect(result.headers["x-api-key"]).toBe("llmux-secret");
		});

		it("Anthropic 模型使用 anthropic 端点", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-6", messages, {
				api_key: "key",
			});

			expect(result.url).toBe(`${defaultApiBase}/v1/messages`);
			const body = result.body as Record<string, unknown>;
			expect(body.model).toBe("claude-sonnet-4-6");
			expect(body.max_tokens).toBe(4096);
		});

		it("OpenAI 模型使用 /v1/chat/completions 端点", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("gpt-5.4", messages, {
				api_key: "key",
			});

			expect(result.url).toBe(`${defaultApiBase}/v1/chat/completions`);
			const body = result.body as Record<string, unknown>;
			expect(body.model).toBe("gpt-5.4");
		});

		it("OpenAI 模型可以传递标准 OpenAI 参数", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("gpt-5.4", messages, {
				api_key: "key",
				temperature: 0.5,
				max_tokens: 200,
			});

			const body = result.body as Record<string, unknown>;
			expect(body.temperature).toBe(0.5);
			expect(body.max_tokens).toBe(200);
		});

		it("non-model 名称不带 provider 前缀时默认 OpenAI 端点", () => {
			const messages: Message[] = [{ role: "user", content: "Test" }];
			const result = provider.transformRequest("some-model", messages, {
				api_key: "key",
			});

			expect(result.url).toBe(`${defaultApiBase}/v1/chat/completions`);
		});
	});

	describe("transformResponse", () => {
		it("解析 Anthropic-style 流式响应", () => {
			const rawResponse = {
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Hello from Claude" }],
				model: "claude-sonnet-4-6",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 5 },
			};

			const result = provider.transformResponse("claude-sonnet-4-6", rawResponse);
			expect(result.choices[0]!.message.content).toBe("Hello from Claude");
			expect(result.usage?.prompt_tokens).toBe(10);
		});

		it("解析 OpenAI-style 响应", () => {
			const rawResponse = {
				id: "chatcmpl-456",
				object: "chat.completion",
				created: 1_700_000_000,
				model: "gpt-5.4",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Hello from GPT" },
						finish_reason: "stop",
					},
				],
			};

			const result = provider.transformResponse("gpt-5.4", rawResponse);
			expect(result.choices[0]!.message.content).toBe("Hello from GPT");
			expect(result.choices).toHaveLength(1);
		});

		it("Anthropic 协议模型丢弃上游 msg_ id，重新生成 chatcmpl-<uuid>（PY anthropic 路径语义）", () => {
			const rawResponse = {
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Hello from Claude" }],
				model: "claude-sonnet-4-6",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 5 },
			};

			const result = provider.transformResponse("claude-sonnet-4-6", rawResponse);
			expect(result.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
		});

		it("OpenAI 协议模型透传上游 truthy id，缺省时回退 chatcmpl-<uuid>", () => {
			const withId = provider.transformResponse("gpt-5.4", {
				id: "chatcmpl-456",
				object: "chat.completion",
				created: 1_700_000_000,
				model: "gpt-5.4",
				choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
			});
			expect(withId.id).toBe("chatcmpl-456");

			const noId = provider.transformResponse("gpt-5.4", {
				object: "chat.completion",
				created: 1_700_000_000,
				model: "gpt-5.4",
				choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
			});
			expect(noId.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
		});
	});

	describe("getSupportedParams", () => {
		it("返回支持的参数列表", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("api_key");
			expect(params).toContain("max_tokens");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});
});
