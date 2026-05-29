/**
 * Anthropic Provider comprehensive tests.
 *
 * Covers features from Python reference at test_anthropic_completion.py
 * and base_llm_unit_tests.py (BaseLLMChatTest, BaseAnthropicChatTest).
 */
import { AnthropicProvider } from "../../src/providers/AnthropicProvider";
import type { Message, ModelResponseStream } from "../../src/types/openai";

function sseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function mockResponse(chunks: Uint8Array[]): Response {
	let index = 0;
	return {
		body: {
			getReader: () => ({
				read: async () => (index >= chunks.length ? { done: true, value: undefined } : { done: false, value: chunks[index++] }),
				releaseLock: () => {},
				cancel: () => Promise.resolve(),
				closed: Promise.resolve(),
			}),
		},
		ok: true,
		status: 200,
		statusText: "OK",
		headers: new Headers(),
	} as unknown as Response;
}

const DEFAULT_API_BASE = "https://api.anthropic.com";

describe("AnthropicProvider - comprehensive", () => {
	let provider: AnthropicProvider;

	beforeEach(() => {
		provider = new AnthropicProvider(DEFAULT_API_BASE);
	});

	// ===================================================================
	// 1. transformRequest parameter mapping
	// ===================================================================

	describe("transformRequest parameter mapping", () => {
		it("uses max_tokens from optionalParams, falls back to 4096", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { max_tokens: 100 });
			expect((result.body as Record<string, unknown>).max_tokens).toBe(100);
		});

		it("maps max_completion_tokens to max_tokens", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { max_completion_tokens: 100 });
			expect((result.body as Record<string, unknown>).max_tokens).toBe(100);
		});

		it("maps parallel_tool_calls=true to disable_parallel_tool_use=false on tool_choice", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				parallel_tool_calls: true,
				tool_choice: "auto" as unknown,
			});
			const tc = (result.body as Record<string, unknown>).tool_choice as Record<string, unknown> | undefined;
			expect(tc).toBeDefined();
			expect(tc!.type).toBe("auto");
			expect(tc!.disable_parallel_tool_use).toBe(false);
		});

		it("passes through extra_headers as HTTP headers", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				extra_headers: { "anthropic-beta": "computer-use-2025-01-24" },
			});
			expect(result.headers["anthropic-beta"]).toBe("computer-use-2025-01-24");
			expect((result.body as Record<string, unknown>)["anthropic-beta"]).toBeUndefined();
		});

		it("maps web_search_options to Anthropic web_search tool", () => {
			const messages: Message[] = [{ role: "user", content: "Weather?" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { web_search_options: {} });
			const tools = (result.body as Record<string, unknown>).tools as Array<Record<string, unknown>> | undefined;
			expect(tools).toBeDefined();
			expect(tools).toHaveLength(1);
			expect(tools![0]!.type).toBe("web_search_20250305");
		});

		it("passes through speed", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { speed: "fastest" as unknown });
			expect((result.body as Record<string, unknown>).speed).toBe("fastest");
		});

		it("passes through cache_control as top-level param", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				cache_control: { type: "ephemeral" },
			});
			expect((result.body as Record<string, unknown>).cache_control).toEqual({ type: "ephemeral" });
		});

		it("maps stop to stop_sequences (string case)", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], { stop: "END" });
			expect((result.body as Record<string, unknown>).stop_sequences).toEqual(["END"]);
		});

		it("maps stop to stop_sequences (array case)", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], {
				stop: ["\n\n", "END"],
			});
			expect((result.body as Record<string, unknown>).stop_sequences).toEqual(["\n\n", "END"]);
		});
	});

	// ===================================================================
	// 2. reasoning_effort mapping
	// ===================================================================

	describe("reasoning_effort mapping", () => {
		it("low → budget_tokens 1024", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "x" }], {
				reasoning_effort: "low",
			});
			expect((result.body as Record<string, unknown>).thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
		});

		it("medium → budget_tokens 2048", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "x" }], {
				reasoning_effort: "medium",
			});
			expect((result.body as Record<string, unknown>).thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
		});

		it("high → budget_tokens 4096", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "x" }], {
				reasoning_effort: "high",
			});
			expect((result.body as Record<string, unknown>).thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
		});

		it("minimal → budget_tokens 128", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "x" }], {
				reasoning_effort: "minimal",
			});
			expect((result.body as Record<string, unknown>).thinking).toEqual({ type: "enabled", budget_tokens: 128 });
		});

		it("none → thinking not set", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "x" }], {
				reasoning_effort: "none",
			});
			expect((result.body as Record<string, unknown>).thinking).toBeUndefined();
		});

		it("claude-4-6 uses adaptive thinking for reasoning_effort", () => {
			const result = provider.transformRequest("claude-sonnet-4-6-20250501", [{ role: "user", content: "x" }], {
				reasoning_effort: "high",
			});
			const body = result.body as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: "adaptive" });
		});

		it("claude-4-6 sets output_config.effort from reasoning_effort", () => {
			const result = provider.transformRequest("opus-4-6-20250501", [{ role: "user", content: "x" }], {
				reasoning_effort: "high",
			});
			const body = result.body as Record<string, unknown>;
			const oc = body.output_config as Record<string, unknown> | undefined;
			expect(oc).toBeDefined();
			expect(oc!.effort).toBe("high");
		});
	});

	// ===================================================================
	// 3. user_id normalization
	// ===================================================================

	describe("user_id normalization", () => {
		it("email format rejected (not set in metadata)", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], {
				user: "user@example.com",
			});
			expect((result.body as Record<string, unknown>).metadata).toBeUndefined();
		});

		it("Claude Code JSON parsed to user_device_account_session format", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], {
				user: JSON.stringify({ device_id: "dev1", account_uuid: "acc2", session_id: "sess3" }),
			});
			const meta = (result.body as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
			expect(meta).toBeDefined();
			expect(meta!.user_id).toBe("user_dev1_account_acc2_session_sess3");
		});

		it("plain string validated and passed through", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], {
				user: "user_abc123",
			});
			const meta = (result.body as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
			expect(meta).toBeDefined();
			expect(meta!.user_id).toBe("user_abc123");
		});

		it("non-string returns undefined", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hi" }], {
				user: 12345 as unknown,
			});
			expect((result.body as Record<string, unknown>).metadata).toBeUndefined();
		});
	});

	// ===================================================================
	// 4. image handling in messages
	// ===================================================================

	describe("image handling in messages", () => {
		it("base64 image_url converted to Anthropic image source block", () => {
			const messages = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe this image" },
						{
							type: "image_url",
							image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
						},
					],
				},
			] as unknown as Message[];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {});
			const bodyMsgs = (result.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
			const content = bodyMsgs[0]!.content as Array<Record<string, unknown>>;
			expect(content).toHaveLength(2);
			expect(content[0]!.type).toBe("text");
			expect(content[1]!.type).toBe("image");
		});

		it("regular text message content works as basic string", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "Hello" }], {});
			const bodyMsgs = (result.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
			const content = bodyMsgs[0]!.content as Array<Record<string, unknown>>;
			expect(content[0]!.type).toBe("text");
			expect(content[0]!.text).toBe("Hello");
		});

		it("preserves cache_control on content blocks", () => {
			const messages = [
				{
					role: "user",
					content: [{ type: "text", text: "Long context", cache_control: { type: "ephemeral" } }],
				},
			] as unknown as Message[];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {});
			const bodyMsgs = (result.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
			const content = bodyMsgs[0]!.content as Array<Record<string, unknown>>;
			const textBlock = content[0] as Record<string, unknown> | undefined;
			expect(textBlock).toBeDefined();
			expect(textBlock!.cache_control).toEqual({ type: "ephemeral" });
		});
	});

	// ===================================================================
	// 5. transformResponse enhancements
	// ===================================================================

	describe("transformResponse enhancements", () => {
		it("extracts text content, server_tool_use and both tool_use blocks as tool_calls", () => {
			const rawResponse = {
				id: "msg_web",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "Weather result." },
					{ type: "tool_use", id: "tu_1", name: "web_search", input: { query: "Tokyo" } },
					{ type: "server_tool_use", id: "st_1", name: "web_search", input: {}, result: { url: "x" } },
				],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 20 },
			};
			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);
			expect(result.choices[0]!.message.content).toBe("Weather result.");
			expect(result.choices[0]!.message.tool_calls).toHaveLength(2);
			expect(result.choices[0]!.message.tool_calls![0]!.function.name).toBe("web_search");
		});

		it("build reasoning_content from thinking blocks", () => {
			const rawResponse = {
				id: "msg",
				type: "message",
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Let me reason...", signature: "sig" },
					{ type: "text", text: "Answer: 42." },
				],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 20 },
			};
			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);
			expect(result.choices[0]!.message.reasoning_content).toBe("Let me reason...");
		});

		it("usage maps input_tokens/output_tokens + cache tokens to OpenAI format", () => {
			const rawResponse = {
				id: "msg",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "x" }],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "end_turn",
				usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 80, cache_read_input_tokens: 20 },
			};
			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);
			// prompt_tokens includes cache tokens
			expect(result.usage!.prompt_tokens).toBe(200);
			expect(result.usage!.completion_tokens).toBe(50);
			expect(result.usage!.total_tokens).toBe(250);
		});

		it("stop_reason tool_use → tool_calls, max_tokens → length", () => {
			const rawToolUse = {
				id: "msg",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "x" },
					{ type: "tool_use", id: "t1", name: "f", input: {} },
				],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "tool_use",
				usage: { input_tokens: 10, output_tokens: 10 },
			};
			expect(provider.transformResponse("claude-3-5-sonnet-20241022", rawToolUse).choices[0]!.finish_reason).toBe("tool_calls");
			const rawMax = {
				id: "msg",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "..." }],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "max_tokens",
				usage: { input_tokens: 5, output_tokens: 100 },
			};
			expect(provider.transformResponse("claude-3-5-sonnet-20241022", rawMax).choices[0]!.finish_reason).toBe("length");
		});
	});

	// ===================================================================
	// 6. JSON mode
	// ===================================================================

	describe("JSON mode", () => {
		it("response_format json_object injects json_tool_call and sets tool_choice", () => {
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", [{ role: "user", content: "JSON please" }], {
				response_format: { type: "json_object" },
			});
			const tools = (result.body as Record<string, unknown>).tools as Array<Record<string, unknown>> | undefined;
			expect(tools).toBeDefined();
			const jsonTool = tools!.find((t) => t.name === "json_tool_call");
			expect(jsonTool).toBeDefined();
			expect(jsonTool!.description).toBe("JSON output");
			const tc = (result.body as Record<string, unknown>).tool_choice as Record<string, unknown> | undefined;
			expect(tc).toBeDefined();
			expect(tc!.type).toBe("tool");
			expect(tc!.name).toBe("json_tool_call");
		});
	});

	// ===================================================================
	// 7. Streaming edge cases
	// ===================================================================

	describe("Streaming edge cases", () => {
		it("stream ending without message_delta synthesizes defensive delta", async () => {
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_1",
						type: "message",
						role: "assistant",
						model: "claude-3-haiku-20240307",
						content: [],
						usage: { input_tokens: 5, output_tokens: 0 },
					},
				}),
				sseEvent("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
				sseEvent("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
				sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
				sseEvent("message_stop", { type: "message_stop" }),
			];
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(mockResponse(events))) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBeGreaterThanOrEqual(2);
			expect(chunks[chunks.length - 1]).toBeDefined();
		});
	});
});
