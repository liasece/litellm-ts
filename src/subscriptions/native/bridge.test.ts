/**
 * 订阅执行桥的账号切换测试。
 *
 * 覆盖「什么时候该换账号」这一层判断：账号级失败（限流、鉴权、额度耗尽）换下一个账号
 * 通常就能成功，而请求体的 4xx 换账号也只是重复失败。CommandCode 对余额不足返回
 * 400 invalid_request_error，这种错误曾被当成普通请求错误，导致整个订阅直接判失败、
 * 掉到跨 Provider fallback，同 Provider 的其他账号一次都没试。
 */

import type { SubscriptionAccountStore } from "./accountStore";
import { SubscriptionBridge } from "./bridge";
import type { SubscriptionProviderLookup } from "./bridge";
import { QuotaAvailability } from "./quota/QuotaAvailability";
import { SubscriptionAccountScheduler } from "./scheduler";
import type { SubscriptionAccount, SubscriptionProviderAdapter, SubscriptionSource } from "./types";

/** 一次被记录的上游调用。 */
interface RecordedCall {
	readonly url: string;
	readonly body: unknown;
}

/**
 * 用固定响应序列构造 fetch，并记录每次调用。
 * @param responses - 依次返回的状态码与响应体；用尽后重复最后一项
 */
function stubFetch(responses: readonly { status: number; body: unknown }[]): {
	calls: RecordedCall[];
	restore: () => void;
} {
	const calls: RecordedCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		const index = Math.min(calls.length, responses.length - 1);
		const current = responses[index]!;
		calls.push({
			url: String(input),
			body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		});
		return new Response(JSON.stringify(current.body), {
			status: current.status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return {
		calls: calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

/**
 * 构造一个账号。
 * @param key - auth 文件名
 * @param weight - 调度权重
 */
function account(key: string, weight = 1): SubscriptionAccount {
	return {
		id: `id-${key}`,
		source: "commandcode" as SubscriptionSource,
		key: key,

		disabled: false,
		weight: weight,
		priority: 0,
		raw: {},
	};
}

/**
 * 构造只满足桥接层需要的账号仓库与适配器。
 * @param accounts - 参与调度的账号
 */
function harness(
	accounts: readonly SubscriptionAccount[],
	options: { quota?: QuotaAvailability; onStateChange?: (source: SubscriptionSource, accountId: string) => void } = {},
): {
	bridge: SubscriptionBridge;
	scheduler: SubscriptionAccountScheduler;
} {
	const store = {
		list: async () => accounts,
		findByKey: async (key: string) => accounts.find((item) => item.key === key),
	} as unknown as SubscriptionAccountStore;
	const adapter: SubscriptionProviderAdapter = {
		source: "commandcode",
		displayName: "CommandCode",
		auth: {
			source: "commandcode",
			ensureCredential: async () => "test-key",
			refresh: async () => undefined,
		},
		supports: () => true,
		route: () => "chat",
		build: async (context) => ({
			url: "https://upstream.test/provider/v1/responses",
			method: "POST",
			headers: { "content-type": "application/json" },
			body: context.upstreamBody,
			stream: false,
			protocol: "chat",
			model: context.model,
		}),
		catalog: async () => [],
		// 额度查询不参与账号切换判定，这里只需满足适配器契约。
		quota: async () => ({ fetchedAt: new Date().toISOString(), windows: [], balances: {} }),
	};
	const providers: SubscriptionProviderLookup = {
		get: () => adapter,
		list: () => [adapter],
	};
	const scheduler = new SubscriptionAccountScheduler({
		blocking: options.quota === undefined ? undefined : (source, now) => options.quota!.blocked(source, now),
	});
	return {
		bridge: new SubscriptionBridge({
			accounts: store,
			scheduler: scheduler,
			providers: providers,
			...(options.quota === undefined ? {} : { quota: options.quota }),
			...(options.onStateChange === undefined ? {} : { onStateChange: options.onStateChange }),
		}),
		scheduler: scheduler,
	};
}

/** 一次 responses 桥接请求。 */
const REQUEST = {
	url: "litellm-subscription://commandcode/chat",
	method: "POST" as const,
	headers: {},
	body: { model: "deepseek/deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }] },
	model: "deepseek/deepseek-v4.1-flash",
	stream: false,
};

/** commandcode 余额不足的真实错误体。 */
const INSUFFICIENT_CREDITS = {
	error: {
		message: "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
		type: "invalid_request_error",
		code: "BAD_REQUEST",
	},
};

describe("订阅桥的账号切换", () => {
	it("余额不足的 400 换下一个账号重试，并让该账号冷却", async () => {
		// 权重集中在第一个账号，确保第一次一定选中它。
		const first = account("commandcode-a.json", 10);
		const second = account("commandcode-b.json", 1);
		const { bridge, scheduler } = harness([first, second]);
		const fetchStub = stubFetch([
			{ status: 400, body: INSUFFICIENT_CREDITS },
			{ status: 200, body: { id: "resp-ok", output: [] } },
		]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(fetchStub.calls).toHaveLength(2);
			expect(result.response.status).toBe(200);
		} finally {
			fetchStub.restore();
		}
		// 空账号进入冷却：后续请求不会再被会话亲和或加权轮询选中。
		for (let attempt = 0; attempt < 5; attempt += 1) {
			expect(scheduler.select("commandcode", "session-1", [first, second]).account.id).toBe(second.id);
		}
	});

	it("周额度用尽的 429 按额度耗尽处理，并按错误里的重置时间冷却", async () => {
		// 生产形态（2026-11-19）：CommandCode 周额度用尽返回 429 + "weekly usage
		// limit … resets at …"，被当成普通限流只冷却 30 秒，于是每个请求都先撞一次
		// 空账号再换号，TTFT p90 到 30~65 秒。
		const first = account("commandcode-a.json", 10);
		const second = account("commandcode-b.json", 1);
		const quota = new QuotaAvailability();
		const changed: string[] = [];
		const { bridge, scheduler } = harness([first, second], {
			quota: quota,
			onStateChange: (source, accountId) => changed.push(`${source}:${accountId}`),
		});
		const resetAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
		const weekly = {
			error: {
				message: `You've reached your weekly usage limit for your plan. Your limit resets at ${resetAt}.`,
				type: "rate_limit_error",
			},
		};
		const fetchStub = stubFetch([
			{ status: 429, body: weekly },
			{ status: 200, body: { id: "resp-ok", output: [] } },
		]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(result.response.status).toBe(200);
			expect(fetchStub.calls).toHaveLength(2);
		} finally {
			fetchStub.restore();
		}
		// 额度闸门记住了这次耗尽：后续请求在选中之前就跳过这个账号。
		const entry = quota.state("commandcode", first.id);
		expect(entry).toBeDefined();
		expect(entry!.exhaustedUntil).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
		expect(changed).toContain(`commandcode:${first.id}`);
		// 冷却也按重置时间走（上限 24 小时），而不是 30 秒。
		for (let attempt = 0; attempt < 5; attempt += 1) {
			expect(scheduler.select("commandcode", "", [first, second]).account.id).toBe(second.id);
		}
	});

	it("普通限流 429 不会被当成额度耗尽", async () => {
		const only = account("commandcode-only.json");
		const quota = new QuotaAvailability();
		const { bridge } = harness([only], { quota: quota });
		const fetchStub = stubFetch([{ status: 429, body: { error: { message: "rate limit exceeded for model" } } }]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(result.response.status).toBe(429);
		} finally {
			fetchStub.restore();
		}
		// 只是限流：不写额度状态，恢复按模型冷却的短窗口，而不是按天。
		expect(quota.entries()).toHaveLength(0);
	});

	it("请求体错误的 400 不换账号", async () => {
		const first = account("commandcode-a.json", 10);
		const second = account("commandcode-b.json", 1);
		const { bridge } = harness([first, second]);
		const fetchStub = stubFetch([
			{ status: 400, body: { error: { message: "messages: field required", type: "invalid_request_error" } } },
			{ status: 200, body: { id: "resp-ok" } },
		]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(fetchStub.calls).toHaveLength(1);
			expect(result.response.status).toBe(400);
		} finally {
			fetchStub.restore();
		}
	});

	it("空账号多于重试预算时仍会走到还有额度的账号", async () => {
		// 生产上遇到过：5 个账号里 3 个余额见底，3 次重试预算被它们吃光，
		// 请求仍然掉到跨 Provider fallback。额度耗尽不占预算后应继续试到有额度的账号。
		const healthy = [account("commandcode-healthy-1.json", 1), account("commandcode-healthy-2.json", 1)];
		const depleted = [
			account("commandcode-empty-1.json", 1),
			account("commandcode-empty-2.json", 1),
			account("commandcode-empty-3.json", 1),
		];
		const { bridge } = harness([...depleted, ...healthy]);
		const fetchStub = stubFetch([
			{ status: 400, body: INSUFFICIENT_CREDITS },
			{ status: 400, body: INSUFFICIENT_CREDITS },
			{ status: 400, body: INSUFFICIENT_CREDITS },
			{ status: 200, body: { id: "resp-ok", output: [] } },
		]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(result.response.status).toBe(200);
			expect(fetchStub.calls.length).toBeGreaterThan(3);
		} finally {
			fetchStub.restore();
		}
	});

	it("所有账号都额度耗尽时保留真实上游错误", async () => {
		const accounts = [account("commandcode-empty-1.json"), account("commandcode-empty-2.json")];
		const { bridge } = harness(accounts);
		const fetchStub = stubFetch([{ status: 400, body: INSUFFICIENT_CREDITS }]);
		try {
			const result = await bridge.execute(REQUEST);
			// 不是合成的「都在冷却中」，调用方仍能看到余额不足这个原因。
			expect(result.response.status).toBe(400);
			expect(fetchStub.calls).toHaveLength(2);
			const body = result.body as { error: { message: string } };
			expect(body.error.message).toContain("insufficient credits");
		} finally {
			fetchStub.restore();
		}
	});

	it("429 只冷却被限流的模型，同账号其他模型继续上游", async () => {
		// 生产形态：一个 Provider 只有一个账号。按账号冷却时，免费模型的 429 会连带
		// 同账号的所有模型一起不可用；按模型冷却后只有被限流的那个模型需要等。
		const only = account("commandcode-only.json");
		const { bridge } = harness([only]);
		const other = { ...REQUEST, model: "deepseek/deepseek-v3", body: { ...REQUEST.body, model: "deepseek/deepseek-v3" } };
		const fetchStub = stubFetch([
			{ status: 429, body: { error: { message: "rate limit exceeded for model" } } },
			{ status: 200, body: { id: "resp-ok", output: [] } },
		]);
		try {
			const limited = await bridge.execute(REQUEST);
			expect(limited.response.status).toBe(429);
			const next = await bridge.execute(other);
			expect(next.response.status).toBe(200);
			expect(fetchStub.calls).toHaveLength(2);

			// 同一模型仍在冷却：这次不再打上游，429 文案要带出模型与上游原因
			await expect(bridge.execute(REQUEST)).rejects.toThrow(/deepseek\/deepseek-v4\.1-flash/);
			await expect(bridge.execute(REQUEST)).rejects.toThrow(/rate limit exceeded for model/);
			expect(fetchStub.calls).toHaveLength(2);
		} finally {
			fetchStub.restore();
		}
	});

	it("账号只剩一个时不重试，避免把同一个空账号打两次", async () => {
		const only = account("commandcode-only.json");
		const { bridge } = harness([only]);
		const fetchStub = stubFetch([{ status: 400, body: INSUFFICIENT_CREDITS }]);
		try {
			const result = await bridge.execute(REQUEST);
			expect(fetchStub.calls).toHaveLength(1);
			expect(result.response.status).toBe(400);
		} finally {
			fetchStub.restore();
		}
	});
});
