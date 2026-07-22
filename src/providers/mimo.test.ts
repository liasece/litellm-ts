/**
 * MiMoProvider 测试
 *
 * 对齐 Python：MiMo 在 PY 无独立 provider（fallback OpenAI 兼容），TS 实际使用 Anthropic
 * 协议且通过组合 AnthropicProvider 复用其全部能力。
 *
 * 覆盖：
 *  - transformRequest 委托给 AnthropicProvider
 *  - tool_choice 映射 (Anthropic 格式)
 *  - response_format json_mode 走 json_tool_call
 *  - reasoning_effort budget 映射
 *  - beta header 注入（web_search 触发 fast-mode 等）
 *  - output_config effort 校验（max 仅 Opus 4.6）
 *  - tool/assistant 流（含 tool_use blocks）
 */
import { MiMoProvider } from "./MiMoProvider";
import { MiMoOpenAIProvider } from "./MiMoOpenAIProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import type { Message } from "../types/openai";

describe("MiMoProvider (composition over AnthropicProvider)", () => {
	const provider = new MiMoProvider();
	const defaultApiBase = "https://token-plan-cn.xiaomimimo.com";

	describe("transformRequest", () => {
		it("使用 Anthropic /v1/messages endpoint", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "mimo-key",
			});

			expect(result.url).toBe(`${defaultApiBase}/v1/messages`);
			expect(result.method).toBe("POST");
			expect(result.headers["x-api-key"]).toBe("mimo-key");
		});

		it("Anthropic-style 请求格式：system + messages + max_tokens", () => {
			const messages: Message[] = [
				{ role: "system", content: "Be concise" },
				{ role: "user", content: "Hello" },
			];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "mimo-key",
			});

			const body = result.body as Record<string, unknown>;
			expect(body.system).toBeDefined();
			expect(body.messages).toBeDefined();
			expect(body.model).toBe("mimo-v2.5-pro");
			expect(body.max_tokens).toBe(4096);
		});

		it("tool_choice 映射到 Anthropic 格式 (auto → type=auto)", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				tool_choice: "auto",
			});
			const body = result.body as Record<string, unknown>;
			expect(body.tool_choice).toEqual({ type: "auto" });
		});

		it("tool_choice 映射: required → type=any", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				tool_choice: "required",
			});
			const body = result.body as Record<string, unknown>;
			expect(body.tool_choice).toEqual({ type: "any" });
		});

		it("tool_choice 映射: function → type=tool + name", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				tools: [{ type: "function", function: { name: "get_weather" } }],
				tool_choice: { type: "function", function: { name: "get_weather" } },
			});
			const body = result.body as Record<string, unknown>;
			expect(body.tool_choice).toEqual({ type: "tool", name: "get_weather" });
		});

		it("response_format json_object 注入 json_tool_call 工具", () => {
			const messages: Message[] = [{ role: "user", content: "Give JSON" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				response_format: { type: "json_object" },
			});
			const body = result.body as Record<string, unknown>;
			expect((body.tools as unknown[]).length).toBeGreaterThan(0);
			const tool = (body.tools as Array<Record<string, unknown>>).find((t) => t.name === "json_tool_call");
			expect(tool).toBeDefined();
			expect(body.json_mode).toBe(true);
		});

		it("reasoning_effort=high 映射到 thinking budget_tokens=4096", () => {
			const messages: Message[] = [{ role: "user", content: "Reason" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "key",
				reasoning_effort: "high",
			});
			const body = result.body as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
		});

		it("output_config.effort=max 在非 Opus 4.6 模型上抛错", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			// 通过 reasoning_effort=max 触发 output_config 注入 → _isOpus46Model 校验
			expect(() =>
				provider.transformRequest("mimo-v2.5-pro", messages, {
					api_key: "key",
					reasoning_effort: "max",
				}),
			).toThrow(/only supported by Claude Opus 4.6/);
		});

		it("tool/assistant 流正确转换为 tool_use + tool_result blocks", () => {
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
				tools: [
					{
						type: "function",
						function: { name: "get_weather", parameters: { type: "object" } },
					},
				],
			});

			const body = result.body as { messages: Array<{ role: string; content: unknown }> };
			const assistantMsg = body.messages[0]!;
			const assistantContent = assistantMsg.content as Array<Record<string, unknown>>;
			expect(assistantContent).toEqual([
				{ type: "text", text: "Let me check" },
				{ type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Beijing" } },
			]);

			const toolMsg = body.messages[1]!;
			expect(toolMsg.role).toBe("user");
			expect(toolMsg.content).toEqual([{ type: "tool_result", tool_use_id: "call_1", content: '{"temp": 20}' }]);
		});

		it("传递 temperature / top_p 透传", () => {
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

			// PY anthropic 路径丢弃上游 id，恒为重新生成的 chatcmpl-<uuid>
			expect(result.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
			expect(result.model).toBe("mimo-v2.5-pro");
			expect(result.choices[0]!.message.content).toBe("I am MiMo!");
			expect(result.choices[0]!.finish_reason).toBe("stop");
			expect(result.usage?.prompt_tokens).toBe(5);
			expect(result.usage?.completion_tokens).toBe(10);
			expect(result.usage?.total_tokens).toBe(15);
		});

		it("处理工具调用响应 (tool_use → tool_calls)", () => {
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
		it("返回 Anthropic 支持参数列表 (含 thinking/reasoning_effort)", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("tools");
			expect(params).toContain("tool_choice");
			expect(params).toContain("thinking");
			expect(params).toContain("reasoning_effort");
			expect(params).toContain("response_format");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});

	describe("composition parity", () => {
		it("暴露的 getSupportedParams 与 AnthropicProvider 相同（composition 已工作）", () => {
			const ap = new AnthropicProvider();
			expect(provider.getSupportedParams()).toEqual(ap.getSupportedParams());
		});
	});
});

describe("MiMoOpenAIProvider (DIFF-CFG-MIMO-01 国际 region)", () => {
	const defaultApiBase = "https://api.xiaomimimo.com/v1";
	const provider = new MiMoOpenAIProvider();

	describe("transformRequest", () => {
		it("使用 OpenAI chat/completions endpoint", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, { api_key: "k" });
			expect(result.url).toBe(`${defaultApiBase}/chat/completions`);
			expect(result.method).toBe("POST");
			expect(result.headers["Authorization"]).toBe("Bearer k");
		});

		it("max_completion_tokens 重映射为 max_tokens（PY param_mappings）", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "k",
				max_completion_tokens: 2048,
			});
			const body = result.body as Record<string, unknown>;
			expect(body.max_tokens).toBe(2048);
			expect(body.max_completion_tokens).toBeUndefined();
		});

		it("max_completion_tokens 与 max_tokens 同时存在时取较大者", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "k",
				max_tokens: 1024,
				max_completion_tokens: 2048,
			});
			const body = result.body as Record<string, unknown>;
			expect(body.max_tokens).toBe(2048);
		});

		it("保留 tools/tool_choice/temperature 透传", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("mimo-v2.5-pro", messages, {
				api_key: "k",
				tools: [{ type: "function", function: { name: "x" } }],
				tool_choice: "auto",
				temperature: 0.3,
			});
			const body = result.body as Record<string, unknown>;
			expect(body.tools).toBeDefined();
			expect(body.tool_choice).toBe("auto");
			expect(body.temperature).toBe(0.3);
		});
	});

	describe("transformResponse", () => {
		it("解析 OpenAI-style 响应", () => {
			const rawResponse = {
				id: "mimo-global-1",
				object: "chat.completion",
				created: 1677652288,
				model: "mimo-v2.5-pro",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Hello" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
			};
			const result = provider.transformResponse("mimo-v2.5-pro", rawResponse);
			expect(result.choices[0]!.message.content).toBe("Hello");
			expect(result.usage?.total_tokens).toBe(15);
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});
});
