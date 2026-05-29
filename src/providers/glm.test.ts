/**
 * GLMProvider 测试
 *
 * 对齐 Python litellm/llms/zai/chat/transformation.py + test_zai_provider.py
 * 验证请求使用 OpenAI 格式（POST /chat/completions）、Bearer auth、max_tokens/stream/tools/tool_choice
 * 透传，模型名去前缀，cache_control 不剥离。
 */
import { GLMProvider } from "./GLMProvider";
import type { Message } from "../types/openai";

describe("GLMProvider", () => {
	const provider = new GLMProvider("", "https://open.bigmodel.cn/api/paas/v4");
	const defaultApiBase = "https://open.bigmodel.cn/api/paas/v4";

	describe("DIFF-CFG-ZAI-01: default api_base", () => {
		it("无 env 无参数时默认 https://api.z.ai/api/paas/v4", () => {
			const p = new GLMProvider();
			const messages: Message[] = [{ role: "user", content: "hi" }];
			const result = p.transformRequest("GLM-5.1", messages, { api_key: "test" });
			expect(result.url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
		});

		it("GLM_API_BASE 环境变量覆盖默认值", () => {
			const prev = process.env.GLM_API_BASE;
			process.env.GLM_API_BASE = "https://custom.example.com/v4";
			try {
				const p = new GLMProvider();
				const messages: Message[] = [{ role: "user", content: "hi" }];
				const result = p.transformRequest("GLM-5.1", messages, { api_key: "test" });
				expect(result.url).toBe("https://custom.example.com/v4/chat/completions");
			} finally {
				if (prev === undefined) {
					delete process.env.GLM_API_BASE;
				} else {
					process.env.GLM_API_BASE = prev;
				}
			}
		});
	});

	describe("DIFF-OPENAI-COMPAT-01: getSupportedParams 限制", () => {
		it("仅返回 9 个核心参数（不含 reasoning_effort/cache_control）", () => {
			const p = new GLMProvider();
			const params = p.getSupportedParams();
			expect(params).toEqual(expect.arrayContaining(["max_tokens", "stream", "temperature", "tools", "tool_choice", "thinking"]));
			expect(params).not.toContain("reasoning_effort");
			expect(params).not.toContain("cache_control");
			expect(params).not.toContain("modalities");
		});

		it("transformRequest 过滤未声明字段", () => {
			const p = new GLMProvider();
			const messages: Message[] = [{ role: "user", content: "hi" }];
			const result = p.transformRequest("GLM-5.1", messages, {
				api_key: "k",
				temperature: 0.5,
				// 未声明字段：
				reasoning_effort: "high",
				cache_control: { type: "ephemeral" },
				modalities: ["text", "image"],
				verbosity: "low",
			});
			const body = result.body as Record<string, unknown>;
			expect(body.temperature).toBe(0.5);
			expect(body.reasoning_effort).toBeUndefined();
			expect(body.cache_control).toBeUndefined();
			expect(body.modalities).toBeUndefined();
			expect(body.verbosity).toBeUndefined();
		});
	});

	describe("transformRequest (OpenAI format)", () => {
		it("使用 OpenAI chat/completions endpoint", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
			});

			expect(result.url).toBe(`${defaultApiBase}/chat/completions`);
			expect(result.method).toBe("POST");
			expect(result.headers["Authorization"]).toBe("Bearer test-key");
			expect(result.headers["Content-Type"]).toBe("application/json");
		});

		it("OpenAI-style 请求格式：model + messages + max_tokens", () => {
			const messages: Message[] = [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hello" },
			];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
				max_tokens: 1024,
			});

			const body = result.body as Record<string, unknown>;
			// PY OpenAI 格式：messages 含 system 角色，无独立 system 字段
			expect(body.messages).toEqual([
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hello" },
			]);
			// DIFF-009: PY ZAIChatConfig 不修改 model name；GLM-5.1 直接透传
			expect(body.model).toBe("GLM-5.1");
			expect(body.max_tokens).toBe(1024);
			expect(body.system).toBeUndefined();
			// 不能出现 Anthropic 风格字段
			expect(body.tool_choice).toBeUndefined();
		});

		it("支持 tools 透传 (OpenAI function 格式)", () => {
			const messages: Message[] = [{ role: "user", content: "What's the weather?" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "test-key",
				tools: [
					{
						type: "function",
						function: { name: "get_weather", parameters: { type: "object" } },
					},
				],
				tool_choice: "auto",
			});

			const body = result.body as Record<string, unknown>;
			expect(body.tools).toEqual([{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }]);
			expect(body.tool_choice).toBe("auto");
		});

		it("支持 stream / temperature / top_p / stop 透传", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "key",
				stream: true,
				temperature: 0.5,
				top_p: 0.9,
				stop: ["END"],
			});

			const body = result.body as Record<string, unknown>;
			expect(body.stream).toBe(true);
			expect(body.temperature).toBe(0.5);
			expect(body.top_p).toBe(0.9);
			expect(body.stop).toEqual(["END"]);
			expect(result.stream).toBe(true);
		});

		it("DIFF-009: 不剥离 glm- / chatglm- 前缀（PY ZAIChatConfig 不修改 model name）", () => {
			const messages: Message[] = [{ role: "user", content: "Hello" }];
			const glm47 = provider.transformRequest("glm-4.7", messages, { api_key: "test-key" });
			// DIFF-009: 前缀保留，上游 z.ai API 直接接收完整模型名
			expect((glm47.body as { model: string }).model).toBe("glm-4.7");

			const chatglm = provider.transformRequest("chatglm-6b", messages, { api_key: "test-key" });
			expect((chatglm.body as { model: string }).model).toBe("chatglm-6b");
		});

		it("thinking 参数透传（对齐 PY supports_reasoning 路径）", () => {
			const messages: Message[] = [{ role: "user", content: "Reason please" }];
			const result = provider.transformRequest("GLM-5.1", messages, {
				api_key: "key",
				thinking: { type: "enabled" },
			});
			const body = result.body as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: "enabled" });
		});

		it("tool 消息保留 OpenAI 格式（不转换为 Anthropic tool_result）", () => {
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
			const toolMsg = body.messages[body.messages.length - 1];
			expect(toolMsg!.role).toBe("tool");
			// OpenAI 格式：tool 角色保留原始 content + tool_call_id
			expect(toolMsg!.content).toBe('{"result": "data"}');
		});
	});

	describe("transformResponse", () => {
		it("解析 OpenAI-style 响应", () => {
			const rawResponse = {
				id: "chatcmpl-zai-123",
				object: "chat.completion",
				created: 1677652288,
				model: "glm-4.6",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Hello! I'm GLM." },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
			};

			const result = provider.transformResponse("GLM-5.1", rawResponse);

			expect(result.id).toBe("chatcmpl-zai-123");
			expect(result.model).toBe("GLM-5.1");
			expect(result.object).toBe("chat.completion");
			expect(result.choices).toHaveLength(1);
			expect(result.choices[0]!.finish_reason).toBe("stop");
			expect(result.choices[0]!.message.content).toBe("Hello! I'm GLM.");
			expect(result.choices[0]!.message.role).toBe("assistant");
			expect(result.usage?.prompt_tokens).toBe(10);
			expect(result.usage?.completion_tokens).toBe(15);
			expect(result.usage?.total_tokens).toBe(25);
		});
	});

	describe("getSupportedParams", () => {
		it("DIFF-OPENAI-COMPAT-01: 仅 9 个核心参数（PY ZAIChatConfig 行为）", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("max_tokens");
			expect(params).toContain("temperature");
			expect(params).toContain("tools");
			expect(params).toContain("tool_choice");
			expect(params).toContain("thinking");
			// 之前透传的 reasoning_effort / cache_control 现已剥离（PY 行为）
			expect(params).not.toContain("reasoning_effort");
			expect(params).not.toContain("cache_control");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});

	describe("streamResponse", () => {
		it("OpenAI 格式 SSE 解析（来自 OpenAICompatProvider 委托）", async () => {
			// 构造一个最小的 OpenAI 风格 SSE Response
			const sseData = [
				'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-4.6","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
				'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-4.6","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
				"data: [DONE]\n\n",
			].join("");
			const stream = new ReadableStream({
				start: function (controller) {
					controller.enqueue(new TextEncoder().encode(sseData));
					controller.close();
				},
			});
			const response = new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});

			const gen = provider.streamResponse?.(response);
			expect(gen).toBeDefined();
			const chunks: unknown[] = [];
			if (gen) {
				for await (const chunk of gen) {
					chunks.push(chunk);
				}
			}
			expect(chunks.length).toBeGreaterThanOrEqual(2);
		});
	});
});
