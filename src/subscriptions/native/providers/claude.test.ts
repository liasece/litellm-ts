/**
 * Claude 订阅 Provider 适配器测试。
 *
 * 覆盖契约（来源/展示名/鉴权）、supports/route/resolveModel 矩阵、Messages 请求的
 * URL、Claude Code 指纹头、Cloaking、system 重定位、thinking 与采样约束、
 * cache_control 断点、count_tokens、Responses compact 的请求/响应转换、额度映射
 * 与错误路径。所有上游调用都由注入的 fetch 假实现承接，不访问网络。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import type {
	SubscriptionAccount,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import { createClaudeProvider } from "./claude";
import { claudeMessagesEndpoint, resolveClaudeBaseUrl, type ClaudeRequestSettings } from "./claudeRequest";
import { claudeCchDigits, normalizeClaudeCchBody, signClaudeCchBody, xxHash64 } from "./claudeCch";
import type { SubscriptionProviderDependencies } from "./types";

/** 一次被记录的请求。 */
interface RecordedCall {
	readonly url: string;
	readonly init: RequestInit;
}

/** Claude 请求体：签名后的 raw 字符串或普通对象。 */
type RequestBody = Record<string, unknown>;

/**
 * 用固定响应构造 fetch，并记录每次调用。
 * @param handler - 按 URL 返回状态码与响应体
 */
function mockFetch(handler: (url: string) => { status: number; body: unknown }): {
	calls: RecordedCall[];
	fetchImpl: typeof fetch;
} {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		calls.push({ url: url, init: init ?? {} });
		const { status, body } = handler(url);
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async (): Promise<string> => (typeof body === "string" ? body : JSON.stringify(body)),
			json: async (): Promise<unknown> => body,
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 构造一个可用的 Claude 账号。 */
function makeAccount(overrides: Partial<SubscriptionAccount> = {}): SubscriptionAccount {
	return {
		id: "acct-claude-1",
		source: "claude",
		fileName: "claude-1.json",
		path: "/tmp/auths/claude-1.json",
		disabled: false,
		weight: 1,
		raw: {
			type: "claude",
			access_token: "sk-ant-oat-test",
			refresh_token: "sk-ant-ort-test",
			account_uuid: "0f0e0d0c-0b0a-4509-8807-060504030201",
			email: "claude@example.com",
		},
		...overrides,
	};
}

/** 生成一个结构上属于 Claude 的 thinking 签名，供目标兼容测试使用。 */
function claudeTestSignature(): string {
	const container = Buffer.from([0x0a, 0x01, 0x00]);
	return Buffer.concat([Buffer.from([0x12, container.length]), container, Buffer.from([0x18, 0x01])]).toString("base64");
}

/** 用内存账号列表构造账号仓库。 */
function makeStore(accounts: readonly SubscriptionAccount[]): SubscriptionAccountStore {
	return {
		list: async (source?: SubscriptionSource): Promise<readonly SubscriptionAccount[]> =>
			source === undefined ? accounts : accounts.filter((account) => account.source === source),
	} as unknown as SubscriptionAccountStore;
}

/** 创建被测适配器。 */
function makeProvider(
	options: {
		accounts?: readonly SubscriptionAccount[];
		fetch?: typeof fetch;
		settings?: ClaudeRequestSettings;
	} = {},
): SubscriptionProviderAdapter {
	const dependencies: SubscriptionProviderDependencies = {
		accounts: makeStore(options.accounts ?? [makeAccount()]),
		...(options.fetch === undefined ? {} : { fetch: options.fetch }),
	};
	return createClaudeProvider(dependencies, options.settings === undefined ? {} : { settings: options.settings });
}

/** 构造入口请求上下文。 */
function makeContext(overrides: Partial<SubscriptionRequestContext> = {}): SubscriptionRequestContext {
	return {
		source: "claude",
		operation: "messages",
		model: "claude-sonnet-4-5-20250929",
		inbound: "messages",
		body: {
			model: "claude-sonnet-4-5-20250929",
			messages: [{ role: "user", content: "hi" }],
			stream: false,
		},
		headers: {},
		stream: false,
		sessionKey: "x-session-id:test-session-1",
		...overrides,
	};
}

/** 构造已选定上游协议的执行上下文。 */
function makeUpstream(
	context: SubscriptionRequestContext,
	upstream: SubscriptionWireProtocol,
	upstreamBody?: Record<string, unknown>,
	credential = "sk-ant-oat-test",
	account: SubscriptionAccount = makeAccount(),
): SubscriptionUpstreamContext {
	return {
		...context,
		upstream: upstream,
		upstreamBody: upstreamBody ?? { ...context.body },
		account: account,
		credential: credential,
	};
}

/**
 * 取出实际请求体对象；Cloaking 开启时是已签名的 raw JSON 字符串。
 * @param plan - 上游请求计划
 */
function bodyOf(plan: SubscriptionUpstreamPlan): RequestBody {
	if (plan.body === undefined) {
		throw new Error("缺少请求体");
	}
	if (typeof plan.body === "string") {
		return JSON.parse(plan.body) as RequestBody;
	}
	return plan.body as RequestBody;
}

/**
 * 取请求头里的 beta 列表。
 * @param plan - 上游请求计划
 */
function betasOf(plan: SubscriptionUpstreamPlan): string[] {
	const header = plan.headers["anthropic-beta"] ?? "";
	return header.split(",").filter(Boolean);
}

// ---------------------------------------------------------------------------
// 契约与路由
// ---------------------------------------------------------------------------

describe("Claude 适配器契约", () => {
	test("声明来源、展示名并由 createClaudeAuth 处理鉴权", () => {
		const provider = makeProvider();
		expect(provider.source).toBe("claude");
		expect(provider.displayName).toBe("Claude");
		expect(provider.auth.source).toBe("claude");
		expect(typeof provider.auth.ensureCredential).toBe("function");
	});
});

describe("supports 与 route", () => {
	const provider = makeProvider();

	test("承接对话、count_tokens 与 compact，拒绝其他操作", () => {
		expect(provider.supports("messages", "claude-sonnet-4-5")).toBe(true);
		expect(provider.supports("chat", "claude-sonnet-4-5")).toBe(true);
		expect(provider.supports("responses", "claude-sonnet-4-5")).toBe(true);
		expect(provider.supports("count_tokens", "claude-sonnet-4-5")).toBe(true);
		expect(provider.supports("compact", "claude-sonnet-4-5")).toBe(true);
		expect(provider.supports("images.generations", "claude-sonnet-4-5")).toBe(false);
		expect(provider.supports("messages", "   ")).toBe(false);
	});

	test("对话类入口固定走 messages，count_tokens/compact 保持入口语义", () => {
		expect(provider.route(makeContext({ operation: "messages", inbound: "messages" }))).toBe("messages");
		expect(provider.route(makeContext({ operation: "chat", inbound: "chat" }))).toBe("messages");
		expect(provider.route(makeContext({ operation: "responses", inbound: "responses" }))).toBe("messages");
		expect(provider.route(makeContext({ operation: "count_tokens", inbound: "responses" }))).toBe("responses");
		expect(provider.route(makeContext({ operation: "compact", inbound: "responses" }))).toBe("responses");
	});

	test("resolveModel 去掉 provider 前缀、[1m] 与 thinking 后缀", () => {
		expect(provider.resolveModel?.("claude-subscription/claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
		expect(provider.resolveModel?.("claude/claude-opus-4-5")).toBe("claude-opus-4-5");
		expect(provider.resolveModel?.("claude-sonnet-4-5[1m]")).toBe("claude-sonnet-4-5");
		expect(provider.resolveModel?.("claude-sonnet-4-5(8192)")).toBe("claude-sonnet-4-5");
		expect(provider.resolveModel?.("claude-sonnet-4-5[1m](4096)")).toBe("claude-sonnet-4-5");
	});
});

describe("URL 与默认基址", () => {
	test("Messages 与 count_tokens 端点都带 beta=true", () => {
		expect(claudeMessagesEndpoint("https://api.anthropic.com", false)).toBe("https://api.anthropic.com/v1/messages?beta=true");
		expect(claudeMessagesEndpoint("https://api.anthropic.com", true)).toBe(
			"https://api.anthropic.com/v1/messages/count_tokens?beta=true",
		);
	});

	test("账号 base_url 优先，其次设置，最后官方地址", () => {
		expect(resolveClaudeBaseUrl(makeAccount({ raw: { base_url: "https://proxy.example/anthropic/" } }), {})).toBe(
			"https://proxy.example/anthropic",
		);
		expect(resolveClaudeBaseUrl(makeAccount(), { baseUrl: "https://settings.example" })).toBe("https://settings.example");
		expect(resolveClaudeBaseUrl(makeAccount(), {})).toBe("https://api.anthropic.com");
	});
});

// ---------------------------------------------------------------------------
// Messages 请求
// ---------------------------------------------------------------------------

describe("Messages 请求", () => {
	test("生成 Claude Code 指纹头、Cloaking system 与 CCH 签名", async () => {
		const provider = makeProvider();
		const context = makeContext({
			model: "claude-opus-5",
			body: {
				model: "claude-opus-5",
				max_tokens: 2048,
				system: "You are a careful assistant.",
				messages: [
					{ role: "user", content: "first" },
					{ role: "assistant", content: "answer" },
					{ role: "user", content: "second" },
				],
				stream: false,
			},
		});
		const plan = await provider.build(makeUpstream(context, "messages"));

		expect(plan.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
		expect(plan.method).toBe("POST");
		expect(plan.protocol).toBe("messages");
		expect(plan.bodyEncoding).toBe("raw");
		expect(plan.stream).toBe(false);
		expect(plan.model).toBe("claude-opus-5");

		expect(plan.headers["Authorization"]).toBe("Bearer sk-ant-oat-test");
		expect(plan.headers["anthropic-version"]).toBe("2023-06-01");
		expect(plan.headers["x-app"]).toBe("cli");
		expect(plan.headers["user-agent"]).toContain("claude-cli/");
		expect(plan.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
		expect(plan.headers["x-stainless-timeout"]).toBe("600");
		expect(plan.headers["x-claude-code-session-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

		const betas = betasOf(plan);
		expect(betas).toContain("claude-code-20250219");
		expect(betas).toContain("oauth-2025-04-20");
		expect(betas).toContain("interleaved-thinking-2025-05-14");
		expect(betas).toContain("extended-cache-ttl-2025-04-11");
		expect(betas).toContain("effort-2025-11-24");

		const body = bodyOf(plan);
		expect(body["model"]).toBe("claude-opus-5");
		expect(body["max_tokens"]).toBe(2048);

		const system = body["system"] as Record<string, unknown>[];
		expect(system).toHaveLength(2);
		expect(system[0]?.["text"]).toMatch(
			/^x-anthropic-billing-header: cc_version=2\.1\.280\.[0-9a-f]{3}; cc_entrypoint=cli; cch=[0-9a-f]{5};$/,
		);
		expect(system[1]?.["text"]).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
		expect(system[1]?.["cache_control"]).toEqual({ type: "ephemeral" });

		const messages = body["messages"] as Record<string, unknown>[];
		expect(messages[1]?.["role"]).toBe("system");
		const relocated = messages[1]?.["content"] as Record<string, unknown>[];
		expect(relocated[0]?.["text"]).toBe("You are a careful assistant.");

		const metadata = body["metadata"] as Record<string, unknown>;
		const identity = JSON.parse(String(metadata["user_id"])) as Record<string, unknown>;
		expect(identity["device_id"]).toMatch(/^[0-9a-f]{64}$/);
		expect(identity["account_uuid"]).toBe("0f0e0d0c-0b0a-4509-8807-060504030201");
		expect(identity["session_id"]).toBe(plan.headers["x-claude-code-session-id"]);
	});

	test("CCH 数字是 5 位小写十六进制，且同一请求可复现", async () => {
		const provider = makeProvider();
		const context = makeContext();
		const first = await provider.build(makeUpstream(context, "messages"));
		const second = await provider.build(makeUpstream(context, "messages"));
		const body = bodyOf(first);
		const system = body["system"] as Record<string, unknown>[];
		const billing = String(system[0]?.["text"]);
		const cch = /cch=([0-9a-f]{5});/.exec(billing)?.[1];
		expect(cch).toBeDefined();
		expect(billing).toBe(String((bodyOf(second)["system"] as Record<string, unknown>[])[0]?.["text"]));
	});

	test("缺少 max_tokens 时取目录里的 max_completion_tokens", async () => {
		const provider = makeProvider();
		const plan = await provider.build(makeUpstream(makeContext(), "messages"));
		expect(bodyOf(plan)["max_tokens"]).toBe(64000);
	});

	test("未知模型回退 1024，且可被设置覆盖", async () => {
		const provider = makeProvider();
		const unknown = await provider.build(makeUpstream(makeContext({ model: "claude-unknown-9" }), "messages"));
		expect(bodyOf(unknown)["max_tokens"]).toBe(1024);

		const overridden = makeProvider({ settings: { maxTokens: (): number => 777 } });
		const plan = await overridden.build(makeUpstream(makeContext(), "messages"));
		expect(bodyOf(plan)["max_tokens"]).toBe(777);
	});

	test("chat 入口的上游仍是 Messages，并声明 messages 协议", async () => {
		const provider = makeProvider();
		const context = makeContext({
			operation: "chat",
			inbound: "chat",
			stream: true,
			body: { model: "claude-sonnet-4-5-20250929", messages: [{ role: "user", content: "hi" }], stream: true },
		});
		const upstreamBody = {
			model: "claude-sonnet-4-5-20250929",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			max_tokens: 4096,
		};
		const plan = await provider.build(makeUpstream(context, "messages", upstreamBody));
		expect(plan.protocol).toBe("messages");
		expect(plan.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
		expect(plan.stream).toBe(true);
		expect(plan.headers["Accept"]).toBe("text/event-stream");
		expect(bodyOf(plan)["max_tokens"]).toBe(4096);
	});

	test("旧模型把调用方 system 转成 system-reminder", async () => {
		const provider = makeProvider();
		const context = makeContext({
			model: "claude-3-7-sonnet-20250219",
			body: {
				model: "claude-3-7-sonnet-20250219",
				system: [{ type: "text", text: "Follow the house rules." }],
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		const messages = body["messages"] as Record<string, unknown>[];
		const content = messages[0]?.["content"] as Record<string, unknown>[];
		expect(String(content[0]?.["text"])).toBe("<system-reminder>\nFollow the house rules.\n</system-reminder>");
		expect(betasOf(await provider.build(makeUpstream(context, "messages")))).not.toContain("mid-conversation-system-2026-04-07");
	});

	test("关闭 Cloaking 时保留调用方 system 并发送 JSON body", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			body: {
				model: "claude-sonnet-4-5-20250929",
				system: "Plain system.",
				messages: [{ role: "user", content: "hi" }],
			},
		});
		const plan = await provider.build(makeUpstream(context, "messages"));
		expect(plan.bodyEncoding).toBe("json");
		expect(typeof plan.body).toBe("object");
		const body = bodyOf(plan);
		const system = body["system"] as Record<string, unknown>[];
		expect(system).toHaveLength(1);
		expect(system[0]?.["text"]).toBe("Plain system.");
		expect(body["metadata"]).toBeUndefined();
	});

	test("thinking 激活时去掉不兼容的采样参数", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			body: {
				model: "claude-sonnet-4-5-20250929",
				thinking: { type: "enabled", budget_tokens: 2048 },
				temperature: 0.3,
				top_p: 0.8,
				top_k: 5,
				messages: [{ role: "user", content: "think" }],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		expect(body["temperature"]).toBeUndefined();
		expect(body["top_p"]).toBeUndefined();
		expect(body["top_k"]).toBeUndefined();
	});

	test("tool_choice 强制工具时删除 thinking 与空 output_config", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			body: {
				model: "claude-opus-4-5-20251101",
				thinking: { type: "enabled", budget_tokens: 2048 },
				output_config: { effort: "high" },
				tool_choice: { type: "any" },
				tools: [{ name: "lookup", input_schema: { type: "object", properties: {} } }],
				messages: [{ role: "user", content: "use the tool" }],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		expect(body["thinking"]).toBeUndefined();
		expect(body["output_config"]).toBeUndefined();
	});

	test("cache_control 断点不超过 4 个", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const system = Array.from({ length: 6 }, (_, index) => ({
			type: "text",
			text: `block-${index}`,
			cache_control: { type: "ephemeral" },
		}));
		const context = makeContext({
			body: { model: "claude-sonnet-4-5-20250929", system: system, messages: [{ role: "user", content: "hi" }] },
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		const markers = (body["system"] as Record<string, unknown>[]).filter((block) => block["cache_control"] !== undefined);
		expect(markers).toHaveLength(4);
	});

	test("没有断点时给最后一个工具补默认 cache_control", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			body: {
				model: "claude-sonnet-4-5-20250929",
				tools: [
					{ name: "first", input_schema: { type: "object" } },
					{ name: "second", input_schema: { type: "object" } },
				],
				messages: [{ role: "user", content: "hi" }],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		const tools = body["tools"] as Record<string, unknown>[];
		expect(tools[0]?.["cache_control"]).toBeUndefined();
		expect(tools[1]?.["cache_control"]).toEqual({ type: "ephemeral" });
	});

	test("thinking 后缀转成 budget thinking，并去掉后缀后的模型名", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			model: "claude-sonnet-4-5-20250929(8192)",
			body: { model: "claude-sonnet-4-5-20250929(8192)", messages: [{ role: "user", content: "hi" }] },
		});
		const plan = await provider.build(makeUpstream(context, "messages"));
		expect(plan.model).toBe("claude-sonnet-4-5-20250929");
		const body = bodyOf(plan);
		expect(body["model"]).toBe("claude-sonnet-4-5-20250929");
		expect(body["thinking"]).toEqual({ type: "enabled", budget_tokens: 8192 });
	});

	test("preserved-thinking 模型补 adaptive 与 block_binding", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			model: "claude-opus-5-5",
			body: {
				model: "claude-opus-5-5",
				messages: [
					{ role: "user", content: "hi" },
					{
						role: "assistant",
						content: [{ type: "thinking", thinking: "reasoning", signature: claudeTestSignature() }],
					},
				],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		expect(body["thinking"]).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
	});

	test("Claude 目标删除无签名/外来 thinking 与 tool_use 签名", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			body: {
				model: "claude-sonnet-4-5-20250929",
				messages: [
					{ role: "user", content: "hi" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "foreign", signature: "0279f465-965e-4262-8138-3fe1bb64d27f" },
							{ type: "thinking", thinking: "missing" },
							{ type: "text", text: "ok" },
							{
								type: "tool_use",
								id: "tool_1",
								name: "lookup",
								input: {},
								thoughtSignature: "Egemini",
							},
						],
					},
					{ role: "assistant", content: [{ type: "thinking", thinking: "only", signature: "gAAAA-foreign" }] },
				],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		const messages = body["messages"] as Record<string, unknown>[];
		expect(messages).toHaveLength(2);
		expect(messages[1]?.["content"]).toMatchObject([
			{ type: "text", text: "ok" },
			{ type: "tool_use", id: "tool_1", name: "lookup", input: {} },
		]);
	});

	test("强制工具调用时不补 preserved thinking", async () => {
		const provider = makeProvider({ settings: { cloaking: false } });
		const context = makeContext({
			model: "claude-opus-5-5",
			body: {
				model: "claude-opus-5-5",
				tool_choice: { type: "any" },
				tools: [{ name: "lookup", input_schema: { type: "object" } }],
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: [{ type: "thinking", thinking: "reasoning", signature: claudeTestSignature() }] },
				],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "messages")));
		expect(body["thinking"]).toBeUndefined();
	});

	test("交互式模型的 thinking.display 补 updates 并追加 beta", async () => {
		const provider = makeProvider();
		const context = makeContext({
			model: "claude-sonnet-5",
			body: {
				model: "claude-sonnet-5",
				thinking: { type: "adaptive" },
				messages: [{ role: "user", content: "hi" }],
			},
		});
		const plan = await provider.build(makeUpstream(context, "messages"));
		const body = bodyOf(plan);
		expect((body["thinking"] as Record<string, unknown>)["display"]).toBe("updates");
		expect(betasOf(plan)).toContain("thinking-display-updates-2026-08-18");
	});

	test("[1m] 模型追加 context-1m beta", async () => {
		const provider = makeProvider();
		const context = makeContext({ model: "claude-sonnet-4-5[1m]" });
		const plan = await provider.build(makeUpstream(context, "messages"));
		expect(betasOf(plan)).toContain("context-1m-2025-08-07");
	});

	test("OAuth 凭据始终以 Bearer 发送，客户端 beta 透传", async () => {
		const provider = makeProvider();
		const context = makeContext({ headers: { "anthropic-beta": "custom-beta-2030-01-01" } });
		const plan = await provider.build(makeUpstream(context, "messages", undefined, "another-token"));
		expect(plan.headers["Authorization"]).toBe("Bearer another-token");
		expect(betasOf(plan)).toContain("custom-beta-2030-01-01");
	});

	test("超长工具名在签名前改名，响应可按映射还原", async () => {
		const provider = makeProvider();
		const original = `mcp__${"x".repeat(100)}`;
		const context = makeContext();
		const body = {
			...context.body,
			tools: [{ name: original, input_schema: { type: "object", properties: {} } }],
		};
		const plan = await provider.build(makeUpstream({ ...context, body: body }, "messages", body));
		const sent = bodyOf(plan);
		const tools = sent["tools"] as Array<Record<string, unknown>>;
		expect(typeof tools[0]?.["name"]).toBe("string");
		expect(String(tools[0]?.["name"]).length).toBeLessThanOrEqual(64);
		expect(plan.toolNames?.get(String(tools[0]?.["name"]))).toBe(original);
	});

	test("body.betas 只进入 anthropic-beta 头，不会作为请求体字段发给上游", async () => {
		const provider = makeProvider();
		const context = makeContext();
		const body = { ...context.body, betas: ["custom-beta-2031-01-01"] };
		const plan = await provider.build(makeUpstream({ ...context, body: body }, "messages", body));
		expect(betasOf(plan)).toContain("custom-beta-2031-01-01");
		expect(bodyOf(plan)["betas"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// count_tokens 与 compact
// ---------------------------------------------------------------------------

describe("count_tokens", () => {
	test("messages 入口的 count_tokens 仍声明 messages 协议", async () => {
		const provider = makeProvider();
		const context = makeContext({ operation: "count_tokens", inbound: "messages" });
		const plan = await provider.build(makeUpstream(context, "messages"));
		expect(plan.protocol).toBe("messages");
	});

	test("使用 count_tokens 端点、token-counting beta，并把 system 移入 messages", async () => {
		const provider = makeProvider();
		const context = makeContext({
			operation: "count_tokens",
			inbound: "responses",
			model: "claude-opus-5",
			body: {
				model: "claude-opus-5",
				messages: [{ role: "user", content: "count me" }],
				system: "Counted system prompt.",
				metadata: { user_id: "legacy" },
			},
		});
		const plan = await provider.build(makeUpstream(context, "responses"));

		expect(plan.url).toBe("https://api.anthropic.com/v1/messages/count_tokens?beta=true");
		expect(plan.protocol).toBe("responses");
		expect(plan.stream).toBe(false);
		expect(plan.headers["x-stainless-timeout"]).toBeUndefined();
		const betas = betasOf(plan);
		expect(betas).toContain("token-counting-2024-11-01");
		expect(betas).toContain("claude-code-20250219");

		const body = bodyOf(plan);
		expect(body["system"]).toBeUndefined();
		expect(body["metadata"]).toBeUndefined();
		expect(body["stream"]).toBeUndefined();
		expect(body["max_tokens"]).toBeUndefined();
		const messages = body["messages"] as Record<string, unknown>[];
		expect(messages.some((message) => message["role"] === "system")).toBe(true);
	});
});

describe("Responses compact", () => {
	const provider = makeProvider();

	test("把 Responses input 转成 Messages 摘要请求", async () => {
		const context = makeContext({
			operation: "compact",
			inbound: "responses",
			model: "claude-sonnet-4-5-20250929",
			body: {
				model: "claude-sonnet-4-5-20250929",
				stream: true,
				tools: [
					{
						type: "function",
						name: "lookup",
						description: "Look things up",
						parameters: { type: "object", properties: { q: { type: "string" } } },
					},
				],
				input: [
					{ type: "message", role: "user", content: [{ type: "input_text", text: "find the thing" }] },
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "looking" }] },
					{ type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"thing"}' },
					{ type: "function_call_output", call_id: "call_1", output: "found it" },
				],
			},
		});
		const plan = await provider.build(makeUpstream(context, "responses"));
		expect(plan.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
		expect(plan.stream).toBe(false);
		expect(plan.protocol).toBe("messages");

		const body = bodyOf(plan);
		expect(body["stream"]).toBe(false);
		expect(body["tools"]).toHaveLength(1);
		expect(body["tool_choice"]).toEqual({ type: "none" });
		const messages = body["messages"] as Record<string, unknown>[];
		const last = messages[messages.length - 1];
		expect(last?.["role"]).toBe("user");
		expect(JSON.stringify(last?.["content"])).toContain("comprehensive summary");
		const assistant = messages.find((message) => message["role"] === "assistant") as Record<string, unknown>;
		const assistantContent = assistant["content"] as Record<string, unknown>[];
		expect(assistantContent.some((block) => block["type"] === "tool_use" && block["id"] === "call_1")).toBe(true);
	});

	test("没有工具定义时把工具块拍平成文本", async () => {
		const context = makeContext({
			operation: "compact",
			inbound: "responses",
			body: {
				model: "claude-sonnet-4-5-20250929",
				input: [
					{ type: "message", role: "user", content: "run it" },
					{ type: "function_call", call_id: "call_9", name: "shell", arguments: '{"cmd":"ls"}' },
					{ type: "function_call_output", call_id: "call_9", output: "file.txt" },
				],
			},
		});
		const body = bodyOf(await provider.build(makeUpstream(context, "responses")));
		expect(body["tools"]).toBeUndefined();
		expect(body["tool_choice"]).toBeUndefined();
		const text = JSON.stringify(body["messages"]);
		expect(text).toContain("Tool call shell (call_9)");
		expect(text).toContain("Tool result call_9: file.txt");
		expect(text).not.toContain('"tool_use"');
	});

	test("把 Messages 摘要响应封装为 response.compaction 胶囊", () => {
		const context = makeContext({ operation: "compact", inbound: "responses", model: "claude-sonnet-4-5" });
		const upstream = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-4-5",
			content: [{ type: "text", text: "the summary" }],
			usage: { input_tokens: 120, output_tokens: 30 },
		};
		const transformed = provider.transformUpstreamBody?.(context, upstream);
		expect(transformed?.["object"]).toBe("response.compaction");
		expect(transformed?.["model"]).toBe("claude-sonnet-4-5");
		const output = transformed?.["output"] as Record<string, unknown>[];
		expect(output[0]?.["type"]).toBe("compaction");
		expect(String(output[0]?.["encrypted_content"])).toMatch(/^cpa-ag-compact-v1:[A-Za-z0-9_-]+$/);
		expect(transformed?.["usage"]).toEqual({ input_tokens: 120, output_tokens: 30, total_tokens: 150 });
	});

	test("非 compact 操作的上游响应原样返回", () => {
		const context = makeContext({ operation: "messages" });
		const upstream = { id: "msg_1", content: [] };
		expect(provider.transformUpstreamBody?.(context, upstream)).toBe(upstream);
	});

	test("摘要响应缺少文本时抛出", () => {
		const context = makeContext({ operation: "compact", inbound: "responses" });
		expect(() => provider.transformUpstreamBody?.(context, { content: [] })).toThrow(/摘要/);
	});
});

// ---------------------------------------------------------------------------
// 目录与额度
// ---------------------------------------------------------------------------

describe("目录与额度", () => {
	test("目录来自 Claude 静态目录且带 messages 协议", async () => {
		const provider = makeProvider();
		const models = await provider.catalog();
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.protocol === "messages")).toBe(true);
		expect(models.map((model) => model.id)).toContain("claude-sonnet-4-5-20250929");
	});

	test("额度查询映射套餐与窗口剩余比例", async () => {
		const { calls, fetchImpl } = mockFetch((url) => {
			if (url.includes("/api/oauth/usage")) {
				return {
					status: 200,
					body: {
						five_hour: { utilization: 25, resets_at: "2030-01-01T00:00:00Z" },
						seven_day: { utilization: 60, resets_at: "2030-01-07T00:00:00Z" },
					},
				};
			}
			return { status: 200, body: { account: { has_claude_pro: true } } };
		});
		const provider = makeProvider({ fetch: fetchImpl });
		const snapshot = await provider.quota(makeAccount());
		expect(calls.map((call) => call.url)).toEqual([
			"https://api.anthropic.com/api/oauth/usage",
			"https://api.anthropic.com/api/oauth/profile",
		]);
		expect(snapshot.plan).toBe("Pro");
		expect(snapshot.fetchedAt).toBeTruthy();
		expect(snapshot.windows?.map((window) => window.name)).toEqual(["5 小时", "7 天"]);
		expect(snapshot.windows?.[0]?.remainingFraction).toBeCloseTo(0.75);
		expect(snapshot.windows?.[0]?.resetTime).toBe("2030-01-01T00:00:00.000Z");
	});

	test("缺少 access_token 时额度查询失败", async () => {
		const provider = makeProvider({ accounts: [makeAccount({ raw: { type: "claude" } })] });
		await expect(provider.quota(makeAccount({ raw: { type: "claude" } }))).rejects.toThrow(/access_token/);
	});

	test("未承接的操作在 build 时拒绝", async () => {
		const provider = makeProvider();
		const context = makeContext({ operation: "images.generations" as SubscriptionOperation });
		await expect(provider.build(makeUpstream(context, "messages"))).rejects.toBeInstanceOf(ApiError);
	});
});

// ---------------------------------------------------------------------------
// CCH 签名
// ---------------------------------------------------------------------------

describe("CCH 签名", () => {
	test("归一化清空所有 model 值并删除排除成员", () => {
		const normalized = normalizeClaudeCchBody(
			'{"model":"claude-sonnet-4-5","max_tokens":1024,"fallbacks":[{"x":1}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}',
		);
		expect(normalized).toBe('{"model":"","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}');
	});

	test("非 JSON 输入抛出", () => {
		expect(() => normalizeClaudeCchBody("not json")).toThrow();
	});

	test("签名把占位符替换为 5 位小写十六进制", () => {
		const body = '{"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.280.abc; cc_entrypoint=cli; cch=00000;"}]}';
		const signed = signClaudeCchBody(body);
		expect(signed).toMatch(/cch=[0-9a-f]{5};/);
		expect(signed).not.toContain("cch=00000;");
	});

	test("签名钩子可覆盖 CCH 并校验格式", () => {
		const body = '{"system":[{"type":"text","text":"x-anthropic-billing-header: cch=00000;"}]}';
		expect(signClaudeCchBody(body, { hook: (): string => "abcde" })).toContain("cch=abcde;");
		expect(() => signClaudeCchBody(body, { hook: (): string => "ABCDE" })).toThrow(/5 位小写十六进制/);
	});

	test("与 Claude Code 2.1.220 已知 CCH 向量一致", () => {
		const base =
			'{"model":"model-a","messages":[{"role":"user","content":[{"type":"text","text":"x"}]}],"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.220.test; cc_entrypoint=sdk-cli; cch=00000;"},{"type":"text","text":"system-x"}],"tools":[],"metadata":{"user_id":"meta-x"},"max_tokens":1,"thinking":{"type":"adaptive","display":"omitted"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"output_config":{"effort":"high"},"stream":true}';
		const cases: [string, string, string][] = [
			["base", base, "7ee87"],
			["model 值被忽略", base.replace('"model":"model-a"', '"model":"model-b"'), "7ee87"],
			["消息影响哈希", base.replace('"text":"x"', '"text":"y"'), "b9cc8"],
			["嵌套 model 被清空", base.replace('"metadata":{"user_id":"meta-x"}', '"metadata":{"user_id":"meta-x","model":"a"}'), "0601b"],
			["嵌套派发字段被剔除", base.replace('"metadata":{"user_id":"meta-x"}', '"metadata":{"user_id":"meta-x","max_tokens":2}'), "7ee87"],
			[
				"字段顺序敏感",
				'{"stream":true,"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"thinking":{"type":"adaptive","display":"omitted"},"max_tokens":1,"metadata":{"user_id":"meta-x"},"tools":[],"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.220.test; cc_entrypoint=sdk-cli; cch=00000;"},{"type":"text","text":"system-x"}],"messages":[{"role":"user","content":[{"type":"text","text":"x"}]}],"model":"model-a"}',
				"e5b6c",
			],
		];
		for (const [name, body, expected] of cases) {
			expect([name, claudeCchDigits(body)]).toEqual([name, expected]);
		}
	});

	test("xxHash64 与已知向量一致", () => {
		expect(xxHash64(Buffer.from("", "utf8"), 0n)).toBe(0xef46db3751d8e999n);
		expect(xxHash64(Buffer.from("a", "utf8"), 0n)).toBe(0xd24ec4f1a98c6e5bn);
		const block = Buffer.alloc(32);
		for (let index = 0; index < block.length; index += 1) {
			block[index] = index % 251;
		}
		// 与 pierrec/xxHash 的 Checksum 对齐，锁定 >=32 字节分支的合并与长度补偿。
		expect(xxHash64(block, 0x4d659218e32a3268n)).toBe(0xd37ae0882f52d673n);
	});
});
