import { MiMoProvider } from "./MiMoProvider";
import type { Message } from "../types/openai";

describe("MiMoProvider", () => {
	const provider = new MiMoProvider();
	const defaultApiBase = "https://token-plan-cn.xiaomimimo.com";

	describe("transformRequest", () => {
		it("使用 MiMo API endpoint", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "mimo-key",
			});

			expect(result.url).toBe(`${defaultApiBase}/v1/messages`);
			expect(result.method).toBe("POST");
			expect(result.headers["Authorization"]).toBe("Bearer mimo-key");
		});

		it("Anthropic-style 请求格式", () => {
			const messages: Message[] = [
				{ role: "system", content: "Be concise" },
				{ role: "user", content: "Hello" },
			];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "mimo-key",
			});

			const body = result.body as Record<string, unknown>;
			expect(body.system).toBe("Be concise");
			expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
			expect(body.model).toBe("mimo-v2.5-pro");
			expect(body.max_tokens).toBe(4096);
		});

		it("模型名称映射 (mimo-v2.5-pro, mimo-v2.5)", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];

			const proResult = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
			});
			expect((proResult.body as { model: string }).model).toBe("mimo-v2.5-pro");

			const baseResult = provider.transformRequest("mimo-v2.5", messages, {
				api_key: "key",
			});
			expect((baseResult.body as { model: string }).model).toBe("mimo-v2.5");
		});

		it("传递可选参数", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				temperature: 0.7,
				top_p: 0.9,
			});

			const body = result.body as Record<string, unknown>;
			expect(body.temperature).toBe(0.7);
			expect(body.top_p).toBe(0.9);
		});

		it("tool 消息转换", () => {
			const messages: Message[] = [
				{
					role: "assistant",
					content: "Let me check",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
						},
					],
				},
				{
					role: "tool",
					content: '{"temp": 20}',
					tool_call_id: "call_1",
				} as Message & { tool_call_id: string },
			];

			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
			});

			const body = result.body as { messages: Array<{ role: string; content: unknown }> };
			const assistantMsg = body.messages[0];
			expect(assistantMsg!.content).toEqual([
				{ type: "text", text: "Let me check" },
				{
					type: "tool_use",
					id: "call_1",
					name: "get_weather",
					input: { city: "Beijing" },
				},
			]);

			const toolMsg = body.messages[1];
			expect(toolMsg!.role).toBe("user");
			expect(toolMsg!.content).toEqual([
				{
					type: "tool_result",
					tool_use_id: "call_1",
					content: '{"temp": 20}',
				},
			]);
		});
	});

	describe("transformResponse", () => {
		it("解析 Anthropic-style 响应", () => {
			const rawResponse = {
				id: "mimo_resp_1",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "I am MiMo!" }],
				model: "mimo-v2.5-pro",
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 10 },
			};

			const result = provider.transformResponse("mimo-v2.5-pro", rawResponse);

			expect(result.id).toBe("mimo_resp_1");
			expect(result.model).toBe("mimo-v2.5-pro");
			expect(result.choices[0]!.message.content).toBe("I am MiMo!");
			expect(result.choices[0]!.finish_reason).toBe("stop");
			expect(result.usage).toEqual({
				prompt_tokens: 5,
				completion_tokens: 10,
				total_tokens: 15,
			});
		});

		it("处理工具调用响应", () => {
			const rawResponse = {
				id: "resp_2",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "Checking..." },
					{
						type: "tool_use",
						id: "tu_1",
						name: "search",
						input: { query: "weather" },
					},
				],
				model: "mimo-v2.5",
				stop_reason: "tool_use",
				usage: { input_tokens: 10, output_tokens: 15 },
			};

			const result = provider.transformResponse("mimo-v2.5", rawResponse);

			expect(result.choices[0]!.message.content).toBe("Checking...");
			expect(result.choices[0]!.finish_reason).toBe("tool_calls");
			expect(result.choices[0]!.message.tool_calls).toHaveLength(1);
			expect(result.choices[0]!.message.tool_calls![0]!.function.name).toBe("search");
		});
	});

	describe("getSupportedParams", () => {
		it("返回支持的参数列表", () => {
			expect(provider.getSupportedParams()).toContain("tools");
			expect(provider.getSupportedParams()).toContain("api_key");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});
});
