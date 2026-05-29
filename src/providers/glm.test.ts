import { GLMProvider } from "./GLMProvider";
import type { Message } from "../types/openai";

describe("GLMProvider", () => {
	const provider = new GLMProvider();
	const defaultApiBase = "https://open.bigmodel.cn/api/paas/v4";

	describe("transformRequest", () => {
		it("使用 GLM API endpoint", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
			});

			expect(result.url).toBe(`${defaultApiBase}/messages`);
			expect(result.method).toBe("POST");
			expect(result.headers["Authorization"]).toBe("Bearer test-key");
			expect(result.headers["Content-Type"]).toBe("application/json");
		});

		it("Anthropic-style 请求格式", () => {
			const messages: Message[] = [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hello" },
			];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
			});

			const body = result.body as Record<string, unknown>;
			expect(body.system).toBe("You are helpful");
			expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
			// GLM-5.1 的 "GLM-" 前缀被 stripModelPrefix 去除
			expect(body.model).toBe("5.1");
			expect(body.max_tokens).toBe(4096);
		});

		it("web_search tool 类型映射", () => {
			const messages: Message[] = [{ role: "user", content: "Search something" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
				tools: [
					{ type: "web_search", web_search: { enable: true } },
					{ type: "function", function: { name: "foo" } },
				],
			});

			const body = result.body as { tools: unknown[] };
			expect(body.tools).toHaveLength(2);
			expect(body.tools[0]).toEqual({
				type: "web_search",
				web_search: { enable: true },
			});
			expect(body.tools[1]).toEqual({ type: "function", function: { name: "foo" } });
		});

		it("去除 glm- 前缀", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("glm-4.7", messages, {
				api_key: "test-key",
			});

			const body = result.body as { model: string };
			expect(body.model).toBe("4.7");
		});

		it("tool 消息转换为 Anthropic tool_result 格式", () => {
			const messages: Message[] = [
				{ role: "assistant", content: "Let me check", tool_calls: [] },
				{
					role: "tool",
					content: '{"result": "data"}',
					tool_call_id: "call_123",
				} as Message & { tool_call_id: string },
			];

			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
			});

			const body = result.body as { messages: Array<{ role: string; content: unknown }> };
			const lastMsg = body.messages[body.messages.length - 1];
			expect(lastMsg!.role).toBe("user");
			expect(lastMsg!.content).toEqual([
				{
					type: "tool_result",
					tool_use_id: "call_123",
					content: '{"result": "data"}',
				},
			]);
		});
	});

	describe("transformResponse", () => {
		it("解析 Anthropic-style 响应", () => {
			const rawResponse = {
				id: "msg_test123",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "Hello! I'm GLM." },
					{
						type: "tool_use",
						id: "tu_1",
						name: "get_weather",
						input: { location: "Beijing" },
					},
				],
				model: "GLM-5.1",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 20 },
			};

			const result = provider.transformResponse("GLM-5.1", rawResponse);

			expect(result.id).toBe("msg_test123");
			expect(result.model).toBe("GLM-5.1");
			expect(result.object).toBe("chat.completion");
			expect(result.choices).toHaveLength(1);
			expect(result.choices[0]!.finish_reason).toBe("stop");
			expect(result.choices[0]!.message.content).toBe("Hello! I'm GLM.");
			expect(result.choices[0]!.message.role).toBe("assistant");
			expect(result.choices[0]!.message.tool_calls).toHaveLength(1);
			expect(result.choices[0]!.message.tool_calls![0]!.function.name).toBe("get_weather");
			expect(result.choices[0]!.message.tool_calls![0]!.function.arguments).toBe('{"location":"Beijing"}');
			expect(result.usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 20,
				total_tokens: 30,
			});
		});
	});

	describe("getSupportedParams", () => {
		it("返回支持的参数列表", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("max_tokens");
			expect(params).toContain("temperature");
			expect(params).toContain("tools");
			expect(params).toContain("api_key");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});
});
