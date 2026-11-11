/**
 * Codex Provider 适配器测试。
 *
 * 只 mock 账号仓库与 fetch：`build` 的断言直接检查最终上游 URL / 请求头 / 请求体，
 * quota 与桥接执行使用注入的 fetch，不访问真实网络。
 */

import { SubscriptionAccountScheduler } from "../scheduler";
import { SubscriptionBridge, subscriptionBridgeUrl } from "../bridge";
import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionOperation, SubscriptionRequestContext, SubscriptionUpstreamContext } from "../types";
import { CODEX_DEFAULT_BASE_URL, createCodexProvider } from "./codex";

/** 生成 Codex 原生形状的 encrypted_content，避免测试把任意字符串当作可回放载荷。 */
function codexEncryptedContent(): string {
	const payload = Buffer.alloc(73);
	payload[0] = 0x80;
	for (let index = 9; index < payload.length; index++) {
		payload[index] = index * 7;
	}
	return payload.toString("base64url");
}

/** 测试账号。 */
function codexAccount(overrides: Record<string, unknown> = {}): SubscriptionAccount {
	const raw: Record<string, unknown> = {
		type: "codex",
		access_token: "test-access-token",
		account_id: "acct-123",
		plan_type: "plus",
		expires_at: Date.now() + 60 * 60 * 1000,
		...overrides,
	};
	return {
		id: "codex-test",
		source: "codex",
		fileName: "codex-test.json",
		path: "/tmp/codex-test.json",
		disabled: false,
		weight: 1,
		expiresAt: typeof raw["expires_at"] === "number" ? raw["expires_at"] : undefined,
		raw: raw,
	};
}

/** 最小账号仓库 fake；只有桥接/额度路径会读取。 */
function fakeAccountStore(account: SubscriptionAccount): SubscriptionAccountStore {
	return {
		list: async (source?: string) => (source === undefined || source === "codex" ? [account] : []),
		findByFileName: async (fileName: string) => (fileName === account.fileName ? account : undefined),
	} as unknown as SubscriptionAccountStore;
}

/** 默认 fetch：build 测试不应发起网络请求。 */
const rejectFetch: typeof fetch = async () => {
	throw new Error("测试不应发起网络请求");
};

/** 创建 provider。 */
function providerWith(fetchImpl: typeof fetch = rejectFetch, account: SubscriptionAccount = codexAccount()) {
	return createCodexProvider({ accounts: fakeAccountStore(account), fetch: fetchImpl });
}

/** 构造上游上下文。 */
function upstreamContext(
	options: {
		readonly operation?: SubscriptionOperation;
		readonly inbound?: SubscriptionRequestContext["inbound"];
		readonly body?: Record<string, unknown>;
		readonly headers?: Record<string, string>;
		readonly stream?: boolean;
		readonly sessionKey?: string;
		readonly account?: SubscriptionAccount;
		readonly rawBody?: unknown;
		readonly model?: string;
	} = {},
): SubscriptionUpstreamContext {
	const body = options.body ?? { model: "gpt-5.6-sol", input: "hi" };
	const formModel = typeof FormData !== "undefined" && options.rawBody instanceof FormData ? options.rawBody.get("model") : undefined;
	const bodyModel = typeof body["model"] === "string" ? body["model"] : undefined;
	const model = options.model ?? bodyModel ?? (typeof formModel === "string" ? formModel : "gpt-5.6-sol");
	return {
		source: "codex",
		operation: options.operation ?? "responses",
		model: model,
		inbound: options.inbound ?? "responses",
		body: body,
		headers: options.headers ?? {},
		rawBody: options.rawBody,
		stream: options.stream ?? false,
		sessionKey: options.sessionKey ?? "session-1",
		upstream: "responses",
		upstreamBody: body,
		account: options.account ?? codexAccount(),
		credential: "test-access-token",
	};
}

/** 读取请求头（大小写不敏感）。 */
function headerOf(headers: Record<string, string>, name: string): string | undefined {
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === target) {
			return value;
		}
	}
	return undefined;
}

/** 断言计划 body 是对象。 */
function bodyOf(plan: { readonly body?: unknown }): Record<string, unknown> {
	expect(plan.body).toBeTruthy();
	return plan.body as Record<string, unknown>;
}

/** UUID v5 形态。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("Codex provider", () => {
	test("标识、支持的操作与协议选择", async () => {
		const provider = providerWith();
		expect(provider.source).toBe("codex");
		expect(provider.displayName).toBe("Codex");

		for (const operation of [
			"chat",
			"messages",
			"responses",
			"compact",
			"images.generations",
			"images.edits",
			"alpha.search",
			"count_tokens",
		] as const) {
			expect(provider.supports(operation, "gpt-5.6-sol")).toBe(true);
		}
		for (const operation of ["completions", "videos", "speech", "live", "realtime", "models"] as const) {
			expect(provider.supports(operation, "gpt-5.6-sol")).toBe(false);
		}
		expect(provider.supports("chat", "   ")).toBe(false);

		expect(provider.route(upstreamContext({ inbound: "chat" }))).toBe("responses");
		expect(provider.route(upstreamContext({ inbound: "messages" }))).toBe("responses");
		expect(provider.route(upstreamContext({ inbound: "responses" }))).toBe("responses");
	});

	test("模型映射去掉订阅前缀", () => {
		const provider = providerWith();
		expect(provider.resolveModel?.("codex-subscription/gpt-6.1-sol")).toBe("gpt-6.1-sol");
		expect(provider.resolveModel?.("codex/gpt-6.1-sol")).toBe("gpt-6.1-sol");
		expect(provider.resolveModel?.("  gpt-5.6-sol ")).toBe("gpt-5.6-sol");
		expect(provider.resolveModel?.("openai/gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
	});

	test("responses 请求特化：URL、鉴权/会话头、字段与托管工具", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				stream: true,
				headers: {
					Version: "0.154.0",
					"User-Agent": "codex_cli_rs/0.154.0 (Mac OS 26.5.2; arm64)",
					"X-Client-Request-Id": "req-1",
					"X-Codex-Turn-State": "turn-state",
					"OpenAI-Beta": "responses=experimental",
					"Session-Id": "header-session",
				},
				body: {
					model: "gpt-5.5",
					input: "hello",
					max_completion_tokens: 2048,
					metadata: { user_id: "u-1" },
					temperature: 0.3,
					top_p: 0.9,
					truncation: "auto",
					user: "u-1",
					previous_response_id: "resp-prev",
					stream_options: { include_usage: true },
					service_tier: "fast",
					prompt_cache_key: "sess-42",
					include: ["web_search_call.action.sources"],
					tools: [{ type: "web_search_preview" }],
				},
			}),
		);

		expect(plan.url).toBe(`${CODEX_DEFAULT_BASE_URL}/responses`);
		expect(plan.method).toBe("POST");
		expect(plan.stream).toBe(true);
		expect(plan.protocol).toBe("responses");
		expect(plan.model).toBe("gpt-5.5");
		expect(headerOf(plan.headers, "Authorization")).toBe("Bearer test-access-token");
		expect(headerOf(plan.headers, "Chatgpt-Account-Id")).toBe("acct-123");
		expect(headerOf(plan.headers, "Originator")).toBe("codex-tui");
		expect(headerOf(plan.headers, "User-Agent")).toBe("codex_cli_rs/0.154.0 (Mac OS 26.5.2; arm64)");
		expect(headerOf(plan.headers, "Session-Id")).toBe("sess-42");
		expect(headerOf(plan.headers, "Accept")).toBe("text/event-stream");
		expect(headerOf(plan.headers, "Content-Type")).toBe("application/json");
		expect(headerOf(plan.headers, "Connection")).toBe("Keep-Alive");
		expect(headerOf(plan.headers, "Version")).toBe("0.154.0");
		expect(headerOf(plan.headers, "X-Client-Request-Id")).toBe("req-1");
		expect(headerOf(plan.headers, "X-Codex-Turn-State")).toBe("turn-state");
		expect(headerOf(plan.headers, "OpenAI-Beta")).toBe("responses=experimental");
		expect(headerOf(plan.headers, "X-Codex-Routing-Hint")).toBe("model=gpt-5.5;tier=priority");

		const body = bodyOf(plan);
		expect(body["store"]).toBe(false);
		expect(body["stream"]).toBe(true);
		expect(body["instructions"]).toBe("");
		expect(body["max_output_tokens"]).toBe(2048);
		expect(body["service_tier"]).toBe("priority");
		expect(body["include"]).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources"]);
		expect(body["prompt_cache_key"]).toBe("sess-42");
		expect(body["input"]).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]);
		expect(body["tools"]).toEqual([{ type: "web_search" }, { type: "image_generation", output_format: "png" }]);
		expect(body["parallel_tool_calls"]).toBe(true);
		for (const key of [
			"max_completion_tokens",
			"metadata",
			"temperature",
			"top_p",
			"truncation",
			"user",
			"previous_response_id",
			"stream_options",
		]) {
			expect(body).not.toHaveProperty(key);
		}
	});

	test("chat 入口补会话缓存键并修复历史项；缺省非流式", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				inbound: "chat",
				stream: false,
				sessionKey: "conv-abc",
				body: {
					model: "gpt-5.5",
					input: [
						{
							type: "message",
							id: "system-1",
							role: "system",
							content: [{ type: "input_text", text: "sys", prompt_cache_breakpoint: true }],
						},
						{ type: "reasoning", id: "rs_keep", encrypted_content: codexEncryptedContent(), summary: [] },
						{ type: "function_call", id: "call_1", name: "lookup", arguments: "" },
						{ type: "message", id: "bad id!?*", role: "user", content: "plain text" },
					],
					tools: [{ type: "web_search_preview_2025_03_11" }],
				},
			}),
		);

		expect(plan.stream).toBe(true);
		expect(plan.aggregateSse).toBe(true);
		expect(headerOf(plan.headers, "Accept")).toBe("text/event-stream");
		const sessionId = headerOf(plan.headers, "Session-Id");
		expect(sessionId).toMatch(UUID_PATTERN);
		expect(headerOf(plan.headers, "X-Codex-Routing-Hint")).toBe("model=gpt-5.5");

		const body = bodyOf(plan);
		expect(body["stream"]).toBe(true);
		expect(body["prompt_cache_key"]).toBe(sessionId);
		expect(body["include"]).toEqual(["reasoning.encrypted_content"]);
		const input = body["input"] as Array<Record<string, unknown>>;
		const message = input[0] ?? {};
		expect(message["role"]).toBe("developer");
		const content = message["content"] as Array<Record<string, unknown>>;
		expect(content[0]).toEqual({ type: "input_text", text: "sys" });
		expect(input[1]).toMatchObject({ type: "reasoning", id: "rs_keep", encrypted_content: codexEncryptedContent() });
		expect(input[2]).toMatchObject({ type: "function_call", id: "fc_call_1", arguments: "{}" });
		expect(input[3]).toMatchObject({ id: "msg_bad_id___", content: "plain text" });
		expect(body["tools"]).toEqual([{ type: "web_search" }, { type: "image_generation", output_format: "png" }]);
		expect(body["parallel_tool_calls"]).toBe(true);
	});

	test("免费套餐不注入 image_generation 工具", async () => {
		const account = codexAccount({ plan_type: "free" });
		const provider = providerWith(rejectFetch, account);
		const plan = await provider.build(upstreamContext({ body: { model: "gpt-5.5", input: "hi" }, account: account }));
		const body = bodyOf(plan);
		expect(body).not.toHaveProperty("tools");
		expect(body).not.toHaveProperty("parallel_tool_calls");
	});

	test("Responses Lite 模型不注入图片工具并移除 web_search 历史", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				body: {
					model: "gpt-5.6-sol",
					input: [
						{ type: "web_search_call", id: "ws-1", status: "completed" },
						{ type: "message", id: "u1", role: "user", content: "hi" },
					],
					tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
				},
			}),
		);
		const body = bodyOf(plan);
		expect(body["tools"]).toEqual([{ type: "function", name: "lookup", parameters: { type: "object" } }]);
		expect(body["parallel_tool_calls"]).toBe(false);
		const input = body["input"] as Array<Record<string, unknown>>;
		expect(input).toHaveLength(1);
		expect(input[0]).toMatchObject({ id: "msg_u1" });
	});

	test("gpt-6* 与 registry 标记的 Lite 模型都不注入托管工具", async () => {
		const provider = providerWith();
		for (const model of ["gpt-6.1-sol", "gpt-6-astra", "codex-auto-review"]) {
			const plan = await provider.build(upstreamContext({ body: { model: model, input: "hi" } }));
			const body = bodyOf(plan);
			expect(body).not.toHaveProperty("tools");
			expect(body["parallel_tool_calls"]).toBe(false);
		}
		const standard = await provider.build(upstreamContext({ body: { model: "gpt-5.5", input: "hi" } }));
		const standardBody = bodyOf(standard);
		expect(standardBody["parallel_tool_calls"]).toBe(true);
		expect(standardBody["tools"]).toEqual([{ type: "image_generation", output_format: "png" }]);
	});

	test("count_tokens 在本地用 tiktoken 估算且不发请求", async () => {
		const provider = providerWith();
		const count = await provider.countTokens?.({
			source: "codex",
			operation: "count_tokens",
			model: "gpt-5.5",
			inbound: "responses",
			body: { model: "gpt-5.5", input: "hello world" },
			headers: {},
			stream: false,
			sessionKey: "count-session",
		});
		expect(count).toBeGreaterThan(0);
	});

	test("桥接 count_tokens 走本地计数且不访问上游", async () => {
		const account = codexAccount();
		const provider = providerWith(rejectFetch, account);
		const bridge = new SubscriptionBridge({
			accounts: fakeAccountStore(account),
			scheduler: new SubscriptionAccountScheduler(),
			providers: {
				get: (source) => (source === "codex" ? provider : undefined),
				list: () => [provider],
			},
		});
		const fetchSpy = jest.spyOn(globalThis, "fetch");
		try {
			const result = await bridge.execute({
				url: subscriptionBridgeUrl("codex", "messages/count_tokens"),
				method: "POST",
				headers: {},
				body: { model: "gpt-5.5", messages: [{ role: "user", content: "hello world" }] },
				model: "gpt-5.5",
				stream: false,
			});
			const counted = result.body as Record<string, unknown>;
			expect(typeof counted["input_tokens"]).toBe("number");
			expect(counted["input_tokens"]).toBeGreaterThan(0);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("超长加密推理项被丢弃", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				body: {
					model: "gpt-5.5",
					input: [
						{ type: "reasoning", id: "r".repeat(70), encrypted_content: "enc" },
						{ type: "message", id: "u1", role: "user", content: "hi" },
					],
				},
			}),
		);
		const input = bodyOf(plan)["input"] as Array<Record<string, unknown>>;
		expect(input).toHaveLength(1);
		expect(input[0]).toMatchObject({ type: "message" });
	});

	test("外来 thinking 签名不会被当作 Codex encrypted_content 回放", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				body: {
					model: "gpt-6-astra",
					input: [
						{
							type: "reasoning",
							id: "rs_foreign",
							encrypted_content: "0279f465-965e-4262-8138-3fe1bb64d27f",
							summary: [{ type: "summary_text", text: "deepseek thinking" }],
						},
						{ type: "message", id: "u1", role: "user", content: "hi" },
					],
				},
			}),
		);
		const input = bodyOf(plan)["input"] as Array<Record<string, unknown>>;
		expect(input).toHaveLength(1);
		expect(input[0]).toMatchObject({ type: "message" });
	});

	test("compact 使用 /responses/compact 且保持非流式", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				operation: "compact",
				stream: true,
				body: {
					model: "gpt-5.6-sol",
					stream: true,
					temperature: 0.2,
					input: [{ type: "message", id: "s1", role: "system", content: "system prompt" }, { type: "compaction_trigger" }],
				},
			}),
		);
		expect(plan.url).toBe(`${CODEX_DEFAULT_BASE_URL}/responses/compact`);
		expect(plan.stream).toBe(false);
		expect(plan.aggregateSse).toBeUndefined();
		expect(headerOf(plan.headers, "Accept")).toBe("application/json");
		const body = bodyOf(plan);
		expect(body["store"]).toBe(false);
		expect(body).not.toHaveProperty("stream");
		expect(body["temperature"]).toBe(0.2);
		expect(body["instructions"]).toBe("");
		expect(body["prompt_cache_key"]).toBe(headerOf(plan.headers, "Session-Id"));
		const input = body["input"] as Array<Record<string, unknown>>;
		expect(input[0]).toMatchObject({ role: "developer" });
		expect(body).not.toHaveProperty("tools");
	});

	test("图片生成走直连端点；未知模型给出明确错误", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				operation: "images.generations",
				body: {
					model: "gpt-image-2",
					prompt: "a cat",
					size: "1024x1024",
					quality: "high",
					n: 2,
					response_format: "b64_json",
					stream: true,
				},
			}),
		);
		expect(plan.url).toBe(`${CODEX_DEFAULT_BASE_URL}/images/generations`);
		expect(plan.stream).toBe(false);
		expect(plan.aggregateSse).toBeUndefined();
		expect(headerOf(plan.headers, "Accept")).toBe("application/json");
		const body = bodyOf(plan);
		expect(body).toEqual({
			model: "gpt-image-2",
			prompt: "a cat",
			size: "1024x1024",
			quality: "high",
			n: 2,
			response_format: "b64_json",
		});

		await expect(
			provider.build(
				upstreamContext({
					operation: "images.generations",
					body: { model: "gpt-5.6-sol", prompt: "a cat" },
				}),
			),
		).rejects.toThrow(/gpt-image-2/);
	});

	test("图片编辑把 multipart 转成 JSON data URL", async () => {
		const provider = providerWith();
		const form = new FormData();
		form.append("model", "gpt-image-2.5");
		form.append("prompt", "add a hat");
		form.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "a.png");
		form.append("image", new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }), "b.jpg");
		form.append("mask", new Blob([new Uint8Array([9])], { type: "image/png" }), "m.png");
		form.append("n", "2");
		form.append("partial_images", "1");
		form.append("output_compression", "80");

		const plan = await provider.build(
			upstreamContext({
				operation: "images.edits",
				body: {},
				rawBody: form,
			}),
		);
		expect(plan.url).toBe(`${CODEX_DEFAULT_BASE_URL}/images/edits`);
		expect(headerOf(plan.headers, "Content-Type")).toBe("application/json");
		const body = bodyOf(plan);
		expect(body["model"]).toBe("gpt-image-2.5");
		expect(body["prompt"]).toBe("add a hat");
		expect(body["n"]).toBe(2);
		expect(body["partial_images"]).toBe(1);
		expect(body["output_compression"]).toBe(80);
		expect(body["mask"]).toEqual({ image_url: "data:image/png;base64,CQ==" });
		expect(body["images"]).toEqual([{ image_url: "data:image/png;base64,AQID" }, { image_url: "data:image/jpeg;base64,BAU=" }]);
	});

	test("alpha.search 保持请求体原样并使用 codex_cli_rs Originator", async () => {
		const provider = providerWith();
		const payload = { commands: { search_query: [{ q: "OpenAI" }] } };
		const plan = await provider.build(
			upstreamContext({
				operation: "alpha.search",
				body: payload,
				headers: { Session_id: "search-session", Version: "1.2.3" },
			}),
		);
		expect(plan.url).toBe(`${CODEX_DEFAULT_BASE_URL}/alpha/search`);
		expect(plan.stream).toBe(false);
		expect(headerOf(plan.headers, "Originator")).toBe("codex_cli_rs");
		expect(headerOf(plan.headers, "Session_id")).toBe("search-session");
		expect(headerOf(plan.headers, "Session-Id")).toBeUndefined();
		expect(headerOf(plan.headers, "Accept")).toBe("application/json");
		expect(plan.body).toEqual(payload);
	});

	test("账号缺少 account_id 或 base_url 无效时明确失败", async () => {
		const provider = providerWith();
		await expect(provider.build(upstreamContext({ account: codexAccount({ account_id: undefined }) }))).rejects.toThrow(/account_id/);
		await expect(provider.build(upstreamContext({ account: codexAccount({ base_url: "ftp://example.test" }) }))).rejects.toThrow(
			/base_url/,
		);
	});

	test("账号 base_url 覆盖并去掉尾斜杠", async () => {
		const provider = providerWith();
		const plan = await provider.build(upstreamContext({ account: codexAccount({ base_url: "https://codex.example.test/api/" }) }));
		expect(plan.url).toBe("https://codex.example.test/api/responses");
	});

	test("catalog 合并静态模型与内置图片模型", async () => {
		const provider = providerWith();
		const models = await provider.catalog();
		const ids = models.map((model) => model.id);
		expect(ids).toEqual(expect.arrayContaining(["gpt-6.1-sol", "gpt-image-2", "gpt-image-2.6"]));
		expect(new Set(ids).size).toBe(ids.length);
		expect(models.find((model) => model.id === "gpt-image-2.6")?.protocol).toBe("responses");
		expect(models.find((model) => model.id === "gpt-6.1-sol")?.protocol).toBe("responses");
	});

	test("quota 请求 wham/usage 并映射窗口与余额", async () => {
		const requests: Array<{ readonly url: string; readonly headers: Headers }> = [];
		const fetchMock: typeof fetch = async (input, init) => {
			requests.push({
				url: input instanceof Request ? input.url : String(input),
				headers: new Headers(init?.headers),
			});
			return new Response(
				JSON.stringify({
					plan_type: "plus",
					rate_limit: {
						primary_window: { used_percent: 40, limit_window_seconds: 18_000, reset_at: 1_893_456_000 },
					},
					rate_limit_reset_credits: { available_count: 3 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};
		const provider = providerWith(fetchMock);
		const snapshot = await provider.quota(codexAccount());

		expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/wham/usage");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test-access-token");
		expect(snapshot.plan).toBe("plus");
		expect(snapshot.balances).toEqual({ 限额重置次数: 3 });
		expect(snapshot.windows).toHaveLength(1);
		expect(snapshot.windows?.[0]?.name).toContain("5 小时");
		expect(snapshot.windows?.[0]?.remainingFraction).toBeCloseTo(0.6);
		expect(snapshot.windows?.[0]?.resetTime).toBe(new Date(1_893_456_000_000).toISOString());
		expect(snapshot.error).toBeUndefined();
	});

	test("quota 上游失败时返回错误快照", async () => {
		const provider = providerWith(async () => {
			throw new Error("network down");
		});
		const snapshot = await provider.quota(codexAccount());
		expect(snapshot.error).toContain("network down");
		expect(snapshot.fetchedAt).toBeTruthy();
	});

	test("桥接执行使用 Codex 计划发送请求", async () => {
		const account = codexAccount();
		const provider = providerWith(rejectFetch, account);
		const bridge = new SubscriptionBridge({
			accounts: fakeAccountStore(account),
			scheduler: new SubscriptionAccountScheduler(),
			providers: {
				get: (source) => (source === "codex" ? provider : undefined),
				list: () => [provider],
			},
		});
		const calls: Array<{ readonly url: string; readonly headers: Headers; readonly body: string }> = [];
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			calls.push({
				url: input instanceof Request ? input.url : String(input),
				headers: new Headers(init?.headers),
				body: typeof init?.body === "string" ? init.body : "",
			});
			return new Response(JSON.stringify({ id: "resp-1", object: "response", output: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		try {
			const result = await bridge.execute({
				url: subscriptionBridgeUrl("codex", "responses"),
				method: "POST",
				headers: {},
				body: { model: "gpt-5.6-sol", input: "桥接测试" },
				model: "gpt-5.6-sol",
				stream: false,
			});
			expect(result.response.status).toBe(200);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.url).toBe(`${CODEX_DEFAULT_BASE_URL}/responses`);
			expect(calls[0]?.headers.get("Chatgpt-Account-Id")).toBe("acct-123");
			expect(calls[0]?.headers.get("Session-Id")).toMatch(UUID_PATTERN);
			const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
			expect(sent["store"]).toBe(false);
			expect(sent["stream"]).toBe(true);
			expect(sent["instructions"]).toBe("");
			expect(sent["prompt_cache_key"]).toBe(calls[0]?.headers.get("Session-Id"));
			expect(sent["input"]).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "桥接测试" }] }]);
			expect(result.body).toMatchObject({ id: "resp-1" });
		} finally {
			fetchSpy.mockRestore();
		}
	});

	test("非流式 Messages 请求聚合 Codex SSE 后再翻译", async () => {
		const account = codexAccount();
		const provider = providerWith(rejectFetch, account);
		const bridge = new SubscriptionBridge({
			accounts: fakeAccountStore(account),
			scheduler: new SubscriptionAccountScheduler(),
			providers: {
				get: (source) => (source === "codex" ? provider : undefined),
				list: () => [provider],
			},
		});
		const final = {
			id: "resp-sse",
			object: "response",
			status: "completed",
			model: "gpt-5.6-sol",
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "OK" }],
				},
			],
			usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
		};
		const fetchSpy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: final })}\n\n`, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			);
		try {
			const result = await bridge.execute({
				url: subscriptionBridgeUrl("codex", "messages"),
				method: "POST",
				headers: {},
				body: { model: "gpt-5.6-sol", messages: [{ role: "user", content: "hello" }], max_tokens: 16 },
				model: "gpt-5.6-sol",
				stream: false,
			});
			expect(result.response.status).toBe(200);
			expect(result.body).toMatchObject({ type: "message", role: "assistant" });
			const content = (result.body as Record<string, unknown>)["content"] as Array<Record<string, unknown>>;
			expect(content[0]).toMatchObject({ type: "text", text: "OK" });
		} finally {
			fetchSpy.mockRestore();
		}
	});
	test("流式 Messages 请求把 Codex SSE 翻译成 Anthropic 事件", async () => {
		const account = codexAccount();
		const provider = providerWith(rejectFetch, account);
		const bridge = new SubscriptionBridge({
			accounts: fakeAccountStore(account),
			scheduler: new SubscriptionAccountScheduler(),
			providers: {
				get: (source) => (source === "codex" ? provider : undefined),
				list: () => [provider],
			},
		});
		const sse =
			[
				'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.6-sol","created_at":100}}',
				'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}',
				'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-sol","status":"completed","usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
			].join("\n\n") + "\n\n";
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sse, { status: 200 }));
		try {
			const result = await bridge.execute({
				url: subscriptionBridgeUrl("codex", "messages"),
				method: "POST",
				headers: {},
				body: { model: "gpt-5.6-sol", messages: [{ role: "user", content: "hello" }], max_tokens: 16, stream: true },
				model: "gpt-5.6-sol",
				stream: true,
			});
			expect(result.response.status).toBe(200);
			const text = await result.response.text();
			expect(text).toContain("event: message_start");
			expect(text).toContain("event: message_stop");
			expect(text).not.toContain("event: error");
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
