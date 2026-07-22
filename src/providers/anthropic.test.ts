/**
 * AnthropicProvider 测试
 *
 * 对齐 Python litellm/llms/anthropic/chat/transformation.py (AnthropicConfig)
 * 覆盖：
 *  - output_config effort 校验（max 仅 Opus 4.6）
 *  - response_format native output_format 注入（Claude 4.5+）
 *  - OAuth sk-ant-oat token → Bearer + oauth-2025-04-20 beta header
 *  - code_execution beta header 版本选择
 *  - file blocks → files-api-2025-04-14 + code-execution-2025-05-22 beta
 *  - tools allowed_callers 程序化工具调用 → tool-search-2025-11-19 + skills-2025-10-02
 *  - compact_20260112 → compact-2026-01-12 beta
 *  - AnthropicThinkingParam 类型 export
 */
import { AnthropicProvider, type AnthropicThinkingParam } from "./AnthropicProvider";
import type { Message } from "../types/openai";

describe("AnthropicProvider", () => {
	const provider = new AnthropicProvider();

	describe("output_config effort 校验 (PY: transformation.py:1436-1448)", () => {
		it("Opus 4.6 接受 effort='max'", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			expect(() =>
				provider.transformRequest("claude-opus-4-6", messages, {
					api_key: "k",
					reasoning_effort: "max",
				}),
			).not.toThrow();
		});

		it("非 Opus 4.6 (Sonnet) 拒绝 effort='max'", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			expect(() =>
				provider.transformRequest("claude-sonnet-4-5", messages, {
					api_key: "k",
					reasoning_effort: "max",
				}),
			).toThrow(/only supported by Claude Opus 4.6/);
		});

		it("effort='invalid' 拒绝", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			expect(() =>
				provider.transformRequest("claude-sonnet-4-5", messages, {
					api_key: "k",
					reasoning_effort: "extreme",
				}),
			).toThrow(/Invalid effort value/);
		});

		it("effort='high'/'medium'/'low' 在 Sonnet 接受", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			for (const effort of ["high", "medium", "low"] as const) {
				expect(() =>
					provider.transformRequest("claude-sonnet-4-5", messages, {
						api_key: "k",
						reasoning_effort: effort,
					}),
				).not.toThrow();
			}
		});
	});

	describe("response_format native output_format (Claude 4.5+)", () => {
		it("Sonnet 4.5 + json_schema 注入 output_format 字段", () => {
			const messages: Message[] = [{ role: "user", content: "Give JSON" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				response_format: {
					type: "json_schema",
					json_schema: { schema: { type: "object", properties: { name: { type: "string" } } } },
				},
			});
			const body = result.body as Record<string, unknown>;
			expect(body.output_format).toBeDefined();
			expect(body.json_mode).toBe(true);
			expect(body.output_format).toEqual({
				type: "json_schema",
				schema: expect.objectContaining({ type: "object" }),
			});
			// 不应注入 json_tool_call
			expect((body.tools as unknown[]) ?? []).toHaveLength(0);
		});

		it("非 Claude 4.5+ 走 json_tool_call 工具 fallback", () => {
			const messages: Message[] = [{ role: "user", content: "Give JSON" }];
			const result = provider.transformRequest("claude-3-7-sonnet", messages, {
				api_key: "k",
				response_format: { type: "json_object" },
			});
			const body = result.body as Record<string, unknown>;
			expect(body.output_format).toBeUndefined();
			expect((body.tools as unknown[]).length).toBeGreaterThan(0);
			const tool = (body.tools as Array<Record<string, unknown>>).find((t) => t.name === "json_tool_call");
			expect(tool).toBeDefined();
			expect(body.json_mode).toBe(true);
		});
	});

	describe("OAuth sk-ant-oat token 注入", () => {
		it("sk-ant-oat token 走 Authorization Bearer + oauth-2025-04-20 beta", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "sk-ant-oat01-fake-oauth-token",
			});
			expect(result.headers["Authorization"]).toBe("Bearer sk-ant-oat01-fake-oauth-token");
			expect(result.headers["anthropic-beta"]).toContain("oauth-2025-04-20");
			expect(result.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
			// 不应设置 x-api-key
			expect(result.headers["x-api-key"]).toBeUndefined();
		});

		it("普通 sk-ant-api* token 走 x-api-key", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "sk-ant-api03-fake-key",
			});
			expect(result.headers["x-api-key"]).toBe("sk-ant-api03-fake-key");
			expect(result.headers["Authorization"]).toBeUndefined();
		});
	});

	describe("code_execution beta header 版本选择 (transformation.py:436-437)", () => {
		it("code_execution_20250825 → code-execution-2025-08-25", () => {
			const messages: Message[] = [{ role: "user", content: "Run code" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				tools: [{ type: "code_execution_20250825", name: "code_execution" }],
			});
			expect(result.headers["anthropic-beta"]).toContain("code-execution-2025-08-25");
		});

		it("code_execution_20250522 → code-execution-2025-05-22", () => {
			const messages: Message[] = [{ role: "user", content: "Run code" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				tools: [{ type: "code_execution_20250522", name: "code_execution" }],
			});
			expect(result.headers["anthropic-beta"]).toContain("code-execution-2025-05-22");
		});
	});

	describe("file blocks → files-api + code-execution betas", () => {
		it("messages 含 file block 注入 files-api-2025-04-14", () => {
			const messages: Message[] = [
				{
					role: "user",
					content: [{ type: "file", file_id: "file_123" }] as unknown as string,
				} as unknown as Message,
			];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, { api_key: "k" });
			expect(result.headers["anthropic-beta"]).toContain("files-api-2025-04-14");
			expect(result.headers["anthropic-beta"]).toContain("code-execution-2025-05-22");
		});
	});

	describe("tools allowed_callers → tool-search + skills betas", () => {
		it("tools with allowed_callers 注入 tool-search-2025-11-19 + skills-2025-10-02", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				tools: [
					{
						type: "function",
						function: {
							name: "exec",
							parameters: { type: "object" },
							allowed_callers: ["code_execution_20250825"],
						},
					},
				],
			});
			expect(result.headers["anthropic-beta"]).toContain("tool-search-2025-11-19");
			// DIFF-ANTH-SKILL-01: skills-2025-10-02 单独由 container_with_skills_used 触发，
			// 与 allowed_callers (programmatic) 解耦。
			expect(result.headers["anthropic-beta"]).not.toContain("skills-2025-10-02");
		});
	});

	describe("DIFF-ANTH-SKILL-01: container_with_skills_used 触发 skills-2025-10-02", () => {
		it("context_management.compact_20260112 + container.contents 内 file → 注入 skills beta", () => {
			const messages: Message[] = [
				{ role: "user", content: "Hi" },
				{
					role: "assistant",
					content: "...",
					container: { id: "c1", contents: [{ type: "file", file_id: "f1" }] },
				} as unknown as Message,
			];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				context_management: { edits: [{ type: "compact_20260112" }] },
			});
			expect(result.headers["anthropic-beta"]).toContain("skills-2025-10-02");
		});

		it("缺 container.contents 内 file → 不注入 skills beta", () => {
			const messages: Message[] = [
				{ role: "user", content: "Hi" },
				{
					role: "assistant",
					content: "...",
					container: { id: "c1", contents: [{ type: "text", text: "x" }] },
				} as unknown as Message,
			];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				context_management: { edits: [{ type: "compact_20260112" }] },
			});
			expect(result.headers["anthropic-beta"]).not.toContain("skills-2025-10-02");
		});
	});

	describe("compact_20260112 → compact-2026-01-12 beta", () => {
		it("context_management 含 compact_20260112 edit 注入 compact beta", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				context_management: {
					edits: [{ type: "compact_20260112" }],
				},
			});
			expect(result.headers["anthropic-beta"]).toContain("compact-2026-01-12");
		});
	});

	describe("AnthropicThinkingParam 类型 export (ANT-001)", () => {
		it("类型可作为参数类型注解", () => {
			const thinking: AnthropicThinkingParam = { type: "enabled", budget_tokens: 2048 };
			const messages: Message[] = [{ role: "user", content: "Reason" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				thinking: thinking,
			});
			const body = result.body as Record<string, unknown>;
			expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
		});
	});

	describe("getSupportedParams", () => {
		it("包含 thinking / reasoning_effort / response_format", () => {
			const params = provider.getSupportedParams();
			expect(params).toContain("thinking");
			expect(params).toContain("reasoning_effort");
			expect(params).toContain("response_format");
			expect(params).toContain("extra_headers");
		});
	});

	describe("supportsStreaming", () => {
		it("支持流式", () => {
			expect(provider.supportsStreaming()).toBe(true);
		});
	});

	describe("structured-outputs beta 注入 (output_format 触发)", () => {
		it("output_format 存在时注入 structured-outputs-2025-09-25", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
			});
			expect(result.headers["anthropic-beta"]).toContain("structured-outputs-2025-09-25");
		});
	});

	describe("DIFF-005: memory_20250818 tool 自动注入 context-management beta", () => {
		// 对齐 PY test_anthropic_memory_tool_auto_adds_beta_header
		// (test_anthropic_chat_transformation.py:680-702)
		it("tools 含 type=memory_20250818 自动注入 context-management-2025-06-27 beta header", () => {
			const messages: Message[] = [{ role: "user", content: "Remember this." }];
			const result = provider.transformRequest("claude-3-5-sonnet-20240620", messages, {
				api_key: "k",
				tools: [{ type: "memory_20250818", name: "memory" }],
			});
			expect(result.headers["anthropic-beta"]).toBeDefined();
			expect(result.headers["anthropic-beta"]).toContain("context-management-2025-06-27");
		});

		it("tools 含 name=memory（无 type） 也应注入 beta（向后兼容）", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				tools: [{ name: "memory" }],
			});
			expect(result.headers["anthropic-beta"]).toContain("context-management-2025-06-27");
		});

		it("无 memory tool 时不注入 context-management beta", () => {
			const messages: Message[] = [{ role: "user", content: "Hi" }];
			const result = provider.transformRequest("claude-sonnet-4-5", messages, {
				api_key: "k",
				tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }],
			});
			const beta = (result.headers["anthropic-beta"] as string | undefined) ?? "";
			expect(beta.includes("context-management-2025-06-27")).toBe(false);
		});
	});

	describe("DIFF-006: 流式 citations_delta 透出 provider_specific_fields", () => {
		// 对齐 PY handler.py:1156-1172 — 流式 SSE 解析 citation_delta 时
		// 把 citation 对象挂到 chunk.provider_specific_fields.citations_delta
		it("citation_delta SSE 事件被解析为 provider_specific_fields.citations_delta", async () => {
			const sseStream = [
				`data: ${JSON.stringify({ type: "message_start", message: { id: "m_1", model: "claude", usage: { input_tokens: 10 } } })}`,
				"",
				`data: ${JSON.stringify({
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "citation_delta",
						url: "https://example.com",
						title: "Example",
						supported_text: "evidence",
					},
				})}`,
				"",
				`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })}`,
				"",
			].join("\n");

			const response = new Response(sseStream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});

			const collected: unknown[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				collected.push(chunk);
			}

			const withCitation = collected.find((c) => {
				const cObj = c as Record<string, unknown>;
				const psf = cObj["provider_specific_fields"] as Record<string, unknown> | undefined;
				return psf?.["citations_delta"] !== undefined;
			});
			expect(withCitation).toBeDefined();
			const psf = (withCitation as Record<string, unknown>)["provider_specific_fields"] as Record<string, unknown>;
			const citations = psf["citations_delta"] as Array<Record<string, unknown>>;
			expect(citations.length).toBeGreaterThan(0);
			expect(citations[0]!["url"]).toBe("https://example.com");
		});

		it("content_block_start 携带 citations 时也通过 provider_specific_fields 透出", async () => {
			const sseStream = [
				`data: ${JSON.stringify({ type: "message_start", message: { id: "m_2", model: "claude", usage: { input_tokens: 5 } } })}`,
				"",
				`data: ${JSON.stringify({
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "Quoted text",
						citations: [{ url: "https://src", title: "src" }],
					},
				})}`,
				"",
				`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}`,
				"",
			].join("\n");

			const response = new Response(sseStream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});

			const collected: unknown[] = [];
			for await (const chunk of provider.streamResponse(response)) {
				collected.push(chunk);
			}

			const withCitation = collected.find((c) => {
				const cObj = c as Record<string, unknown>;
				const psf = cObj["provider_specific_fields"] as Record<string, unknown> | undefined;
				return psf?.["citations_delta"] !== undefined;
			});
			expect(withCitation).toBeDefined();
		});
	});

	describe("model 名规范化 (Python get_llm_provider 语义)", () => {
		it("发往 Anthropic Messages API 的 body.model 应剥离 provider 前缀", () => {
			const req = provider.transformRequest("anthropic/gpt-5.5", [{ role: "user", content: "hi" } as Message], {
				api_key: "k",
			});
			expect((req.body as Record<string, unknown>).model).toBe("gpt-5.5");
		});
	});

	describe("api_base 优先级 (Python LiteLLM kwargs 语义)", () => {
		it("optionalParams.api_base 优先于构造函数 _apiBase", () => {
			const defaultProvider = new AnthropicProvider();
			const req = defaultProvider.transformRequest("claude-sonnet-4-6", [{ role: "user", content: "hi" } as Message], {
				api_base: "http://upstream.test",
			});
			expect(req.url).toBe("http://upstream.test/v1/messages");
		});

		it("未传 api_base 时使用构造函数 _apiBase", () => {
			const customProvider = new AnthropicProvider("http://custom.test");
			const req = customProvider.transformRequest("claude-sonnet-4-6", [{ role: "user", content: "hi" } as Message], {});
			expect(req.url).toBe("http://custom.test/v1/messages");
		});

		it("api_base 为空字符串时回退到 _apiBase", () => {
			const customProvider = new AnthropicProvider("http://custom.test");
			const req = customProvider.transformRequest("claude-sonnet-4-6", [{ role: "user", content: "hi" } as Message], {
				api_base: "",
			});
			expect(req.url).toBe("http://custom.test/v1/messages");
		});
	});

	describe("transformResponse 响应 id 与 provider_specific_fields (PY _generate_id / _build_provider_specific_fields)", () => {
		it("丢弃上游 msg_ 前缀 id，重新生成 chatcmpl-<uuid>", () => {
			const result = provider.transformResponse("claude-sonnet-4-6", {
				id: "msg_01ABC",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				model: "claude-sonnet-4-6",
				stop_reason: "end_turn",
				usage: { input_tokens: 3, output_tokens: 2 },
			});
			expect(result.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
		});

		it("message.provider_specific_fields 恒含 citations/thinking_blocks（无引用时为 null）", () => {
			const thinkingBlock = { type: "thinking", thinking: "想", signature: "sig-1" };
			const result = provider.transformResponse("claude-sonnet-4-6", {
				id: "msg_02",
				type: "message",
				role: "assistant",
				content: [thinkingBlock, { type: "text", text: "答" }],
				model: "claude-sonnet-4-6",
				stop_reason: "end_turn",
				usage: { input_tokens: 3, output_tokens: 2 },
			});
			expect(result.choices[0]!.message.provider_specific_fields).toEqual({
				citations: null,
				thinking_blocks: [thinkingBlock],
			});
		});

		it("无思考无引用时 provider_specific_fields 两键均为 null", () => {
			const result = provider.transformResponse("claude-sonnet-4-6", {
				id: "msg_03",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "plain" }],
				model: "claude-sonnet-4-6",
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 1 },
			});
			expect(result.choices[0]!.message.provider_specific_fields).toEqual({ citations: null, thinking_blocks: null });
		});
	});

	describe("流式响应 id (PY handler.py:522 response_id = _generate_id())", () => {
		it("全部 chunk 共享一个预生成 chatcmpl-<uuid>，不取上游 message_start 的 msg_ id", async () => {
			const sseStream = [
				`data: ${JSON.stringify({ type: "message_start", message: { id: "msg_upstream", model: "claude", usage: { input_tokens: 10 } } })}`,
				"",
				`data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "he" } })}`,
				"",
				`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "llo" } })}`,
				"",
				`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })}`,
				"",
			].join("\n");
			const response = new Response(sseStream, { status: 200, headers: { "content-type": "text/event-stream" } });

			const ids = new Set<string>();
			for await (const chunk of provider.streamResponse(response)) {
				ids.add(chunk.id);
			}
			expect(ids.size).toBe(1);
			const [onlyId] = [...ids];
			expect(onlyId).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
			expect(onlyId).not.toBe("msg_upstream");
		});
	});
});
