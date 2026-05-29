/**
 * Anthropic Provider unit tests.
 *
 * Tests the Anthropic Messages API request/response/streaming conversion.
 */

import { AnthropicProvider } from "../../src/providers/AnthropicProvider";
import type { Message, ModelResponseStream } from "../../src/types/openai";

// ---------------------------------------------------------------------------
// Helpers: build mock SSE stream Response
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function mockResponse(chunks: Uint8Array[]): Response {
	let index = 0;
	return {
		body: {
			getReader: () => ({
				read: async () => {
					if (index >= chunks.length) return { done: true, value: undefined };
					return { done: false, value: chunks[index++] };
				},
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

function mockEmptyResponse(): Response {
	return {
		body: null,
		ok: true,
		status: 200,
		statusText: "OK",
		headers: new Headers(),
	} as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = "https://api.anthropic.com";

describe("AnthropicProvider", () => {
	let provider: AnthropicProvider;

	beforeEach(() => {
		provider = new AnthropicProvider(DEFAULT_API_BASE);
	});

	// ===================================================================
	// transformRequest
	// ===================================================================

	describe("transformRequest", () => {
		it("translates basic user message to Anthropic content array format", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {});

			expect(result.url).toBe("https://api.anthropic.com/v1/messages");
			expect(result.method).toBe("POST");
			expect(result.headers["Content-Type"]).toBe("application/json");
			expect(result.headers["anthropic-version"]).toBe("2023-06-01");

			const body = result.body as Record<string, unknown>;
			expect(body.model).toBe("claude-3-5-sonnet-20241022");
			expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
			expect(body.max_tokens).toBe(4096);
		});

		it("extracts system message to top-level system param", () => {
			const messages: Message[] = [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hi" },
			];
			const result = provider.transformRequest("claude-3-opus-20240229", messages, {});

			const body = result.body as Record<string, unknown>;
			expect(body.system).toEqual([{ type: "text", text: "You are a helpful assistant." }]);
			const msgs = body.messages as Array<{ role: string }>;
			expect(msgs).toHaveLength(1);
			expect(msgs[0]!.role).toBe("user");
		});

		it("maps max_tokens from optionalParams", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-haiku-20240307", messages, { max_tokens: 2048 });
			expect((result.body as Record<string, unknown>).max_tokens).toBe(2048);
		});

		it("passes tools through", () => {
			const messages: Message[] = [{ role: "user", content: "Weather?" }];
			const tools = [
				{
					name: "get_weather",
					description: "Get current weather",
					input_schema: {
						type: "object",
						properties: { location: { type: "string" } },
						required: ["location"],
					},
				},
			];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { tools });
			expect((result.body as { tools: unknown[] }).tools).toEqual(tools);
		});

		it("sets stream flag", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, { stream: true });
			expect(result.stream).toBe(true);
		});

		it("maps stop_sequences", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				stop_sequences: ["\n\n", "END"],
			});
			expect((result.body as { stop_sequences: string[] }).stop_sequences).toEqual(["\n\n", "END"]);
		});

		it("passes through temperature and top_p", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				temperature: 0.7,
				top_p: 0.9,
			});
			const body = result.body as Record<string, unknown>;
			expect(body.temperature).toBe(0.7);
			expect(body.top_p).toBe(0.9);
		});

		it("uses api_key from optionalParams for x-api-key header", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {
				api_key: "sk-ant-custom",
			});
			expect(result.headers["x-api-key"]).toBe("sk-ant-custom");
		});

		it("converts tool messages to Anthropic tool_result format", () => {
			const messages: Message[] = [
				{
					role: "assistant",
					content: "Let me check",
					tool_calls: [
						{
							id: "call_abc",
							type: "function",
							function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
						},
					],
				},
				{
					role: "tool",
					content: '{"temp": 22}',
					tool_call_id: "call_abc",
				} as Message & { tool_call_id: string },
			];

			const result = provider.transformRequest("claude-3-5-sonnet-20241022", messages, {});
			const body = result.body as { messages: Array<{ role: string; content: unknown }> };

			expect(body.messages).toHaveLength(2);
			expect(body.messages[0]!.role).toBe("assistant");
			expect(body.messages[0]!.content).toEqual([
				{ type: "text", text: "Let me check" },
				{ type: "tool_use", id: "call_abc", name: "get_weather", input: { city: "Beijing" } },
			]);
			expect(body.messages[1]!.role).toBe("user");
			expect(body.messages[1]!.content).toEqual([{ type: "tool_result", tool_use_id: "call_abc", content: '{"temp": 22}' }]);
		});
	});

	// ===================================================================
	// transformResponse
	// ===================================================================

	describe("transformResponse", () => {
		it("parses text content to ModelResponse", () => {
			const rawResponse = {
				id: "msg_01abc123",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Hello! How can I help you?" }],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 8 },
			};

			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);

			expect(result.id).toBe("msg_01abc123");
			expect(result.object).toBe("chat.completion");
			expect(result.model).toBe("claude-3-5-sonnet-20241022");
			expect(result.choices).toHaveLength(1);
			expect(result.choices[0]!.message.content).toBe("Hello! How can I help you?");
			expect(result.choices[0]!.message.role).toBe("assistant");
			expect(result.choices[0]!.finish_reason).toBe("stop");
		});

		it("parses tool_use blocks", () => {
			const rawResponse: Record<string, unknown> = {
				id: "msg_tool123",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "Let me look that up." },
					{ type: "tool_use", id: "tu_1", name: "get_weather", input: { location: "Boston" } },
				],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "tool_use",
				usage: { input_tokens: 15, output_tokens: 20 },
			};

			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);

			expect(result.choices[0]!.finish_reason).toBe("tool_calls");
			expect(result.choices[0]!.message.tool_calls).toHaveLength(1);
			expect(result.choices[0]!.message.tool_calls![0]!.id).toBe("tu_1");
			expect(result.choices[0]!.message.tool_calls![0]!.function.name).toBe("get_weather");
			expect(result.choices[0]!.message.tool_calls![0]!.function.arguments).toBe('{"location":"Boston"}');
		});

		it("maps stop_reason 'end_turn' to 'stop'", () => {
			const rawResponse = {
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Done" }],
				model: "claude-3-haiku-20240307",
				stop_reason: "end_turn",
				usage: {},
			};
			const result = provider.transformResponse("claude-3-haiku-20240307", rawResponse);
			expect(result.choices[0]!.finish_reason).toBe("stop");
		});

		it("maps stop_reason 'max_tokens' to 'length'", () => {
			const rawResponse = {
				id: "msg_2",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Partial..." }],
				model: "claude-3-haiku-20240307",
				stop_reason: "max_tokens",
				usage: {},
			};
			const result = provider.transformResponse("claude-3-haiku-20240307", rawResponse);
			expect(result.choices[0]!.finish_reason).toBe("length");
		});

		it("extracts usage from Anthropic input_tokens/output_tokens format", () => {
			const rawResponse = {
				id: "msg_usage1",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Hello" }],
				model: "claude-3-haiku-20240307",
				stop_reason: "end_turn",
				usage: { input_tokens: 25, output_tokens: 42 },
			};
			const result = provider.transformResponse("claude-3-haiku-20240307", rawResponse);
			expect(result.usage).toEqual({
				prompt_tokens: 25,
				completion_tokens: 42,
				total_tokens: 67,
			});
		});

		it("extracts combined text from multiple text blocks", () => {
			const rawResponse = {
				id: "msg_multi_text",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "Part one. " },
					{ type: "text", text: "Part two." },
				],
				model: "claude-3-5-sonnet-20241022",
				stop_reason: "end_turn",
				usage: {},
			};
			const result = provider.transformResponse("claude-3-5-sonnet-20241022", rawResponse);
			expect(result.choices[0]!.message.content).toBe("Part one. Part two.");
		});

		it("uses provided usage override over raw response", () => {
			const rawResponse = {
				id: "msg_override",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Override test" }],
				model: "claude-3-haiku-20240307",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 5 },
			};
			const result = provider.transformResponse("claude-3-haiku-20240307", rawResponse, {
				prompt_tokens: 99,
				completion_tokens: 88,
				total_tokens: 187,
			});
			expect(result.usage!.prompt_tokens).toBe(99);
			expect(result.usage!.completion_tokens).toBe(88);
			expect(result.usage!.total_tokens).toBe(187);
		});
	});

	// ===================================================================
	// streamResponse
	// ===================================================================

	describe("streamResponse", () => {
		it("parses message_start event and yields initial chunk", async () => {
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_01stream",
						type: "message",
						role: "assistant",
						model: "claude-3-5-sonnet-20241022",
						content: [],
						usage: { input_tokens: 12, output_tokens: 0 },
					},
				}),
			];

			const response = mockResponse(events);
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}

			expect(chunks).toHaveLength(1);
			expect(chunks[0]!.id).toBe("msg_01stream");
			expect(chunks[0]!.object).toBe("chat.completion.chunk");
			expect(chunks[0]!.choices[0]!.delta.role).toBe("assistant");
			expect(chunks[0]!.choices[0]!.delta.content).toBe("");
			expect(chunks[0]!.choices[0]!.finish_reason).toBeNull();
		});

		it("parses text_delta events in order", async () => {
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_text",
						type: "message",
						role: "assistant",
						model: "claude-3-haiku-20240307",
						content: [],
						usage: { input_tokens: 5, output_tokens: 0 },
					},
				}),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello" },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: " world" },
				}),
				sseEvent("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "end_turn", stop_sequence: null },
					usage: { output_tokens: 5 },
				}),
				sseEvent("message_stop", { type: "message_stop" }),
			];

			const response = mockResponse(events);
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}

			expect(chunks.length).toBeGreaterThanOrEqual(4);
			expect(chunks[2]!.choices[0]!.delta.content).toBe("Hello");
			expect(chunks[3]!.choices[0]!.delta.content).toBe(" world");

			const lastChunk = chunks[chunks.length - 1]!;
			expect(lastChunk.choices[0]!.finish_reason).toBe("stop");
		});

		it("parses tool_use and input_json_delta events", async () => {
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_tool_stream",
						type: "message",
						role: "assistant",
						model: "claude-3-5-sonnet-20241022",
						content: [],
						usage: { input_tokens: 15, output_tokens: 0 },
					},
				}),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Using tool..." },
				}),
				sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_12345",
						name: "get_weather",
						input: {},
					},
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"locat' },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: 'ion":"Boston, MA"}' },
				}),
				sseEvent("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "tool_use", stop_sequence: null },
					usage: { output_tokens: 30 },
				}),
				sseEvent("message_stop", { type: "message_stop" }),
			];

			const response = mockResponse(events);
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}

			const toolStartChunk = chunks.find((c) => c.choices[0]?.delta?.tool_calls?.[0]?.id === "toolu_12345");
			expect(toolStartChunk).toBeDefined();
			expect(toolStartChunk!.choices[0]!.delta.tool_calls![0]!.function!.name).toBe("get_weather");

			const argsChunks = chunks.filter((c) => c.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments);
			expect(argsChunks.length).toBeGreaterThan(0);

			const lastChunk = chunks[chunks.length - 1]!;
			expect(lastChunk.choices[0]!.finish_reason).toBe("tool_calls");
		});

		it("handles empty response body gracefully", async () => {
			const response = mockEmptyResponse();
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}
			expect(chunks).toHaveLength(0);
		});

		it("ignores ping events", async () => {
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_ping",
						type: "message",
						role: "assistant",
						model: "claude-3-haiku-20240307",
						content: [],
						usage: { input_tokens: 3, output_tokens: 0 },
					},
				}),
				sseEvent("ping", { type: "ping" }),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "Hi" },
				}),
				sseEvent("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "end_turn", stop_sequence: null },
					usage: { output_tokens: 1 },
				}),
				sseEvent("message_stop", { type: "message_stop" }),
			];

			const response = mockResponse(events);
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}

			// message_start, content_block_start, message_delta => 3 chunks; ping produces none
			expect(chunks).toHaveLength(3);
		});

		it("adjusts tool_use index from Anthropic global index to OpenAI 0-based", async () => {
			// Anthropic: text at 0, tool_use at 1, tool_use at 2
			// OpenAI expects: tool indices 0, 1
			const events = [
				sseEvent("message_start", {
					type: "message_start",
					message: {
						id: "msg_index_adjust",
						type: "message",
						role: "assistant",
						model: "claude-3-5-sonnet-20241022",
						content: [],
						usage: { input_tokens: 10, output_tokens: 0 },
					},
				}),
				sseEvent("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
				sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: { type: "tool_use", id: "toolu_first", name: "get_weather", input: {} },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"city":"NYC"}' },
				}),
				sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
				sseEvent("content_block_start", {
					type: "content_block_start",
					index: 2,
					content_block: { type: "tool_use", id: "toolu_second", name: "get_time", input: {} },
				}),
				sseEvent("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "tool_use", stop_sequence: null },
					usage: { output_tokens: 25 },
				}),
				sseEvent("message_stop", { type: "message_stop" }),
			];

			const response = mockResponse(events);
			const chunks: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				chunks.push(chunk);
			}

			const firstToolChunk = chunks.find((c) => c.choices[0]?.delta?.tool_calls?.[0]?.id === "toolu_first");
			expect(firstToolChunk).toBeDefined();
			// Anthropic index 1 -> OpenAI tool index 0 (because text block at 0 is subtracted)
			expect(firstToolChunk!.choices[0]!.delta.tool_calls![0]!.index).toBe(0);

			const secondToolChunk = chunks.find((c) => c.choices[0]?.delta?.tool_calls?.[0]?.id === "toolu_second");
			expect(secondToolChunk).toBeDefined();
			// Anthropic index 2 -> OpenAI tool index 1
			expect(secondToolChunk!.choices[0]!.delta.tool_calls![0]!.index).toBe(1);
		});
	});

	// ===================================================================
	// getSupportedParams / supportsStreaming
	// ===================================================================

	describe("getSupportedParams", () => {
		it("returns list of supported Anthropic-specific params", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("max_tokens");
			expect(params).toContain("temperature");
			expect(params).toContain("stop_sequences");
			expect(params).toContain("tools");
			expect(params).toContain("api_key");
			expect(params).toContain("anthropic_version");
		});
	});

	describe("supportsStreaming", () => {
		it("returns true", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});
});
