import { OpenAICompatProvider } from "./OpenAICompatProvider";
import type { ModelResponseStream } from "../types/openai";

describe("OpenAICompatProvider", () => {
	const apiKey = "sk-test-key";
	const apiBase = "https://api.example.com/v1";
	let provider: OpenAICompatProvider;

	beforeEach(() => {
		provider = new OpenAICompatProvider(apiKey, apiBase);
	});

	describe("transformRequest", () => {
		it("creates a basic chat completion request", () => {
			const req = provider.transformRequest("gpt-3.5-turbo", [{ role: "user", content: "Hello" }], {});

			expect(req.url).toBe("https://api.example.com/v1/chat/completions");
			expect(req.method).toBe("POST");
			expect(req.headers["Authorization"]).toBe("Bearer sk-test-key");
			expect(req.headers["Content-Type"]).toBe("application/json");
			expect(req.body).toEqual({
				model: "gpt-3.5-turbo",
				messages: [{ role: "user", content: "Hello" }],
			});
			expect(req.model).toBe("gpt-3.5-turbo");
			expect(req.stream).toBe(false);
		});

		it("sets stream flag when stream param is true", () => {
			const req = provider.transformRequest("gpt-3.5-turbo", [{ role: "user", content: "Hi" }], { stream: true });

			expect(req.stream).toBe(true);
			const body = req.body as Record<string, unknown>;
			expect(body.stream).toBe(true);
		});

		it("strips provider prefix from model name in request body", () => {
			const req = provider.transformRequest("deepseek/deepseek-chat", [{ role: "user", content: "Hello" }], {});

			const body = req.body as Record<string, unknown>;
			expect(body.model).toBe("deepseek-chat");
			expect(req.model).toBe("deepseek/deepseek-chat");
		});

		it("passes through tools, temperature, max_tokens", () => {
			const req = provider.transformRequest("gpt-4", [{ role: "user", content: "Hi" }], {
				temperature: 0.7,
				max_tokens: 100,
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							parameters: { type: "object" },
						},
					},
				],
				tool_choice: "auto",
			});

			const body = req.body as Record<string, unknown>;
			expect(body.temperature).toBe(0.7);
			expect(body.max_tokens).toBe(100);
			expect(body.tools).toBeDefined();
			expect(body.tool_choice).toBe("auto");
		});

		it("sets correct auth header and URL", () => {
			const req = provider.transformRequest("gpt-4", [], {});
			expect(req.url).toBe("https://api.example.com/v1/chat/completions");
			expect(req.headers).toEqual({
				"Content-Type": "application/json",
				Authorization: "Bearer sk-test-key",
			});
			expect(req.method).toBe("POST");
		});
	});

	describe("transformResponse", () => {
		it("parses a standard chat completion response to ModelResponse", () => {
			const rawResponse = {
				id: "chatcmpl-123",
				object: "chat.completion",
				created: 1_677_652_288,
				model: "gpt-3.5-turbo",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Hello there!" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			};

			const result = provider.transformResponse("gpt-3.5-turbo", rawResponse);

			expect(result.id).toBe("chatcmpl-123");
			expect(result.object).toBe("chat.completion");
			expect(result.created).toBe(1_677_652_288);
			expect(result.model).toBe("gpt-3.5-turbo");
			expect(result.choices).toHaveLength(1);
			expect(result.choices[0]!.index).toBe(0);
			expect(result.choices[0]!.message.role).toBe("assistant");
			expect(result.choices[0]!.message.content).toBe("Hello there!");
			expect(result.choices[0]!.finish_reason).toBe("stop");
			expect(result.usage?.prompt_tokens).toBe(10);
			expect(result.usage?.completion_tokens).toBe(5);
			expect(result.usage?.total_tokens).toBe(15);
		});
	});

	describe("getSupportedParams", () => {
		it("returns list of supported OpenAI params", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("temperature");
			expect(params).toContain("max_tokens");
			expect(params).toContain("stream");
			expect(params).toContain("tools");
			expect(params).toContain("tool_choice");
			expect(params).toContain("top_p");
			expect(params).toContain("stop");
		});
	});

	describe("supportsStreaming", () => {
		it("returns true", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});

	describe("streamResponse", () => {
		function createMockResponse(chunks: string[]): Response {
			return new Response(
				new ReadableStream({
					start: function (controller) {
						for (const chunk of chunks) {
							controller.enqueue(new TextEncoder().encode(chunk));
						}
						controller.close();
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		}

		it("parses SSE stream chunks", async () => {
			const chunks = [
				'data: {"id":"1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n',
				'data: {"id":"1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n',
				"data: [DONE]\n",
			];

			const response = createMockResponse(chunks);

			const results: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				results.push(chunk);
			}

			expect(results).toHaveLength(2);
			expect(results[0]!.choices[0]!.delta.content).toBe("Hello");
			expect(results[1]!.choices[0]!.delta.content).toBe(" world");
		});

		it("handles [DONE] sentinel and stops streaming", async () => {
			const response = createMockResponse(["data: [DONE]\n"]);

			const results: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				results.push(chunk);
			}

			expect(results).toHaveLength(0);
		});

		it("handles multiple data lines in one chunk", async () => {
			const response = createMockResponse([
				'data: {"id":"1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n' +
					'data: {"id":"1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}\n',
				"data: [DONE]\n",
			]);

			const results: ModelResponseStream[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				results.push(chunk);
			}

			expect(results).toHaveLength(2);
			expect(results[0]!.choices[0]!.delta.content).toBe("Hi");
			expect(results[1]!.choices[0]!.delta.content).toBe("!");
		});
	});
});
