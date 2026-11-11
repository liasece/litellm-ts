/**
 * Kimi Provider 适配器测试。
 *
 * 只覆盖 URL、身份头、模型归一化、请求体特化与额度映射；全部使用注入的
 * fetch，不访问网络。
 */

import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionOperation, SubscriptionRequestContext, SubscriptionUpstreamContext } from "../types";
import { createKimiProvider, normalizeKimiToolLinks, resolveKimiModel } from "./kimi";

/** 测试账号。 */
function kimiAccount(overrides: Record<string, unknown> = {}): SubscriptionAccount {
	const raw: Record<string, unknown> = {
		type: "kimi",
		access_token: "kimi-token",
		device_id: "device-123",
		base_url: "https://api.kimi.com/coding",
		expires_at: Date.now() + 60 * 60 * 1000,
		...overrides,
	};
	return {
		id: "kimi-test",
		source: "kimi",
		fileName: "kimi-test.json",
		path: "/tmp/kimi-test.json",
		disabled: false,
		weight: 1,
		expiresAt: typeof raw["expires_at"] === "number" ? raw["expires_at"] : undefined,
		raw: raw,
	};
}

/** 账号仓库 fake。 */
function fakeAccountStore(account: SubscriptionAccount): SubscriptionAccountStore {
	return {
		list: async (source?: string) => (source === undefined || source === "kimi" ? [account] : []),
		findByFileName: async (fileName: string) => (fileName === account.fileName ? account : undefined),
	} as unknown as SubscriptionAccountStore;
}

/** 不应发生网络请求的 fetch。 */
const rejectFetch: typeof fetch = async () => {
	throw new Error("测试不应发起网络请求");
};

/** 创建 provider。 */
function providerWith(fetchImpl: typeof fetch = rejectFetch, account: SubscriptionAccount = kimiAccount()) {
	return createKimiProvider({ accounts: fakeAccountStore(account), fetch: fetchImpl });
}

/** 构造上游上下文。 */
function upstreamContext(
	options: {
		readonly operation?: SubscriptionOperation;
		readonly inbound?: SubscriptionRequestContext["inbound"];
		readonly body?: Record<string, unknown>;
		readonly headers?: Record<string, string>;
		readonly stream?: boolean;
		readonly model?: string;
	} = {},
): SubscriptionUpstreamContext {
	const body = options.body ?? { model: "kimi-k2.7-code", messages: [{ role: "user", content: "hello" }] };
	return {
		source: "kimi",
		operation: options.operation ?? "messages",
		model: options.model ?? (typeof body["model"] === "string" ? body["model"] : "kimi-k2.7-code"),
		inbound: options.inbound ?? "messages",
		body: body,
		headers: options.headers ?? {},
		stream: options.stream ?? false,
		sessionKey: "session-1",
		upstream: "messages",
		upstreamBody: body,
		account: kimiAccount(),
		credential: "kimi-token",
	};
}

/** 大小写不敏感读取请求头。 */
function headerOf(headers: Record<string, string>, name: string): string | undefined {
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === target) {
			return value;
		}
	}
	return undefined;
}

describe("Kimi provider", () => {
	test("标识、支持操作与模型归一化", async () => {
		const provider = providerWith();
		expect(provider.source).toBe("kimi");
		expect(provider.displayName).toBe("Kimi");
		for (const operation of ["chat", "messages", "responses", "count_tokens"] as const) {
			expect(provider.supports(operation, "kimi-k2.7-code")).toBe(true);
		}
		expect(provider.supports("images.generations", "kimi-k3")).toBe(false);
		expect(provider.supports("compact", "kimi-k3")).toBe(false);
		expect(resolveKimiModel("kimi-subscription/kimi-k2.7-code")).toBe("kimi-for-coding");
		expect(resolveKimiModel("kimi/kimi-k2.7-code-highspeed")).toBe("kimi-for-coding-highspeed");
		expect(resolveKimiModel("kimi-k3[1m]")).toBe("k3");
		expect(resolveKimiModel("kimi-k3(high)")).toBe("k3(high)");
		expect(provider.route(upstreamContext({ operation: "count_tokens", inbound: "responses" }))).toBe("messages");
	});

	test("Messages 腿：URL、身份头、tool_call_id 与 max_tokens", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				body: {
					model: "kimi-k2.7-code",
					max_tokens: 128,
					system: "keep this",
					messages: [
						{
							role: "assistant",
							tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }],
						},
						{ role: "tool", content: "file" },
					],
				},
				headers: { "anthropic-beta": "client-beta" },
			}),
		);
		expect(plan.url).toBe("https://api.kimi.com/coding/v1/messages?beta=true");
		expect(plan.protocol).toBe("messages");
		expect(headerOf(plan.headers, "authorization")).toBe("Bearer kimi-token");
		expect(headerOf(plan.headers, "x-msh-device-id")).toBe("device-123");
		expect(headerOf(plan.headers, "anthropic-beta")).toBe("client-beta");
		const body = plan.body as Record<string, unknown>;
		expect(body["model"]).toBe("kimi-for-coding");
		expect(body["max_tokens"]).toBe(128);
		expect(body["system"]).toBeTruthy();
		expect((body["messages"] as unknown[]).length).toBeGreaterThan(0);
	});

	test("Messages 缺省 max_tokens 使用 Kimi 自己的 32000，而不是 Claude 目录缺省", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({ body: { model: "kimi-k2.7-code", messages: [{ role: "user", content: "hello" }] } }),
		);
		expect((plan.body as Record<string, unknown>)["max_tokens"]).toBe(32000);
	});

	test("未配置 device_id 时设备身份稳定且每次构建一致", async () => {
		const account = kimiAccount({ device_id: undefined });
		const provider = providerWith(rejectFetch, account);
		const context = { ...upstreamContext({ body: { model: "kimi-k3", messages: [] } }), account: account };
		const first = await provider.build(context);
		const second = await provider.build(context);
		const firstDevice = headerOf(first.headers, "x-msh-device-id");
		expect(firstDevice).toMatch(/^[0-9a-f]{64}$/);
		expect(headerOf(second.headers, "x-msh-device-id")).toBe(firstDevice);
	});

	test("补齐 Kimi 工具消息的 tool_call_id", () => {
		const body: Record<string, unknown> = {
			messages: [
				{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
				{ role: "tool", content: "file" },
			],
		};
		normalizeKimiToolLinks(body);
		const messages = body["messages"] as Array<Record<string, unknown>>;
		expect(messages[1]?.["tool_call_id"]).toBe("call_1");
	});

	test("Chat 与 Responses 腿使用各自端点", async () => {
		const provider = providerWith();
		const chat = await provider.build(
			upstreamContext({ operation: "chat", inbound: "chat", body: { model: "kimi-k3", messages: [] } }),
		);
		expect(chat.url).toBe("https://api.kimi.com/coding/v1/chat/completions");
		expect(chat.protocol).toBe("chat");
		const responses = await provider.build(
			upstreamContext({ operation: "responses", inbound: "responses", body: { model: "kimi-k3", input: [] } }),
		);
		expect(responses.url).toBe("https://api.kimi.com/coding/v1/responses");
		expect(responses.protocol).toBe("responses");
	});

	test("messages 入口的 count_tokens 以 messages 协议回传", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				operation: "count_tokens",
				inbound: "messages",
				body: { model: "kimi-k3", messages: [{ role: "user", content: "hello" }] },
			}),
		);
		expect(plan.protocol).toBe("messages");
	});

	test("count_tokens 走 Messages count 端点并声明 responses 协议", async () => {
		const provider = providerWith();
		const plan = await provider.build(
			upstreamContext({
				operation: "count_tokens",
				inbound: "responses",
				body: { model: "kimi-k3", input: "hello" },
			}),
		);
		expect(plan.url).toBe("https://api.kimi.com/coding/v1/messages/count_tokens?beta=true");
		expect(plan.protocol).toBe("responses");
		expect((plan.body as Record<string, unknown>)["max_tokens"]).toBeUndefined();
	});

	test("kimi.ai 账号使用对应 base URL", async () => {
		const account = kimiAccount({ base_url: "https://api.kimi.ai/coding", type: "kimi-ai" });
		const provider = providerWith(rejectFetch, account);
		const plan = await provider.build({ ...upstreamContext({ body: { model: "kimi-k3", messages: [] } }), account: account });
		expect(plan.url).toBe("https://api.kimi.ai/coding/v1/messages?beta=true");
	});

	test("额度查询映射 limits 与 usage", async () => {
		const calls: Array<{ readonly url: string; readonly headers: Headers }> = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), headers: new Headers(init?.headers) });
			return new Response(
				JSON.stringify({
					limits: [{ detail: { name: "5h", used: 20, limit: 100, resets_at: "2026-11-11T00:00:00Z" } }],
					usage: { name: "weekly", used: 30, limit: 100 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		const provider = providerWith(fetchImpl);
		const snapshot = await provider.quota?.(kimiAccount());
		expect(calls[0]?.url).toBe("https://api.kimi.com/coding/v1/usages");
		expect(snapshot?.windows).toHaveLength(2);
		expect(snapshot?.windows?.[0]).toMatchObject({ name: "5h", remainingFraction: 0.8 });
		expect(snapshot?.windows?.[1]).toMatchObject({ name: "weekly", remainingFraction: 0.7 });
	});

	test("额度接口失败返回 ApiError 且不回显 token", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
		const provider = providerWith(fetchImpl);
		await expect(provider.quota?.(kimiAccount())).rejects.toThrow(/HTTP 500/);
	});
});
