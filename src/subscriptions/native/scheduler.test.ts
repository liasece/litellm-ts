import { ApiError } from "../../core/api/ApiError";
import { SubscriptionAccountScheduler } from "./scheduler";
import type { SubscriptionAccount } from "./types";

function account(id: string, overrides: Partial<SubscriptionAccount> = {}): SubscriptionAccount {
	return {
		id: id,
		source: "codex",
		key: `${id}.json`,

		disabled: false,
		weight: 1,
		priority: 0,
		raw: {},
		...overrides,
	};
}

it("只从最小 priority 层选账号，高层作为后备", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const primary = account("primary", { priority: 1, weight: 100 });
	const backup = account("backup", { priority: 2, weight: 1 });
	for (let index = 0; index < 10; index += 1) {
		expect(scheduler.select("codex", "", [primary, backup]).account.id).toBe("primary");
	}
	expect(scheduler.select("codex", "", [backup]).account.id).toBe("backup");
});

it("weight 0 的账号不参与调度", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const zero = account("zero", { weight: 0 });
	const active = account("active", { weight: 1 });
	for (let index = 0; index < 5; index += 1) {
		expect(scheduler.select("codex", "", [zero, active]).account.id).toBe("active");
	}
	expect(() => scheduler.select("codex", "", [zero])).toThrow(ApiError);
});

it("失败账号在冷却窗口内被跳过，冷却结束后惩罚窗口内仍排到队尾", () => {
	jest.useFakeTimers();
	try {
		jest.setSystemTime(new Date("2026-11-19T00:00:00Z"));
		const scheduler = new SubscriptionAccountScheduler();
		const first = account("first");
		const second = account("second");
		scheduler.markFailure("codex", "first", 429, 60_000);
		for (let index = 0; index < 5; index += 1) {
			expect(scheduler.select("codex", "", [first, second]).account.id).toBe("second");
		}
		// 冷却清掉了，但刚失败过的账号在惩罚窗口内仍然排在队尾：否则一次瞬时失败后
		// 立刻把流量还给它，就会回到「每个请求都先撞同一个账号」的老问题。
		scheduler.markSuccess("codex", "first");
		expect(scheduler.select("codex", "", [first, second]).account.id).toBe("second");
		jest.setSystemTime(new Date(Date.now() + 5 * 60 * 1000 + 1000));
		// 惩罚窗口过后两个账号平等，加权轮询会重新轮到 first。
		const picked = new Set<string>();
		for (let index = 0; index < 4; index += 1) {
			picked.add(scheduler.select("codex", "", [first, second]).account.id);
		}
		expect(picked.has("first")).toBe(true);
	} finally {
		jest.useRealTimers();
	}
});

it("从未失败过的账号优先于最近失败的账号", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const first = account("first");
	const second = account("second");
	const fresh = account("fresh");
	scheduler.markFailure("codex", "first", 429, 1);
	scheduler.markFailure("codex", "second", 429, 1);
	for (let index = 0; index < 5; index += 1) {
		expect(scheduler.select("codex", "", [first, second, fresh]).account.id).toBe("fresh");
	}
});

it("全部账号都刚失败过时，失败时间最远的先试", () => {
	jest.useFakeTimers();
	try {
		jest.setSystemTime(new Date("2026-11-19T00:00:00Z"));
		const scheduler = new SubscriptionAccountScheduler();
		const first = account("first");
		const second = account("second");
		const third = account("third");
		scheduler.markFailure("codex", "first", 429, 1);
		jest.setSystemTime(new Date(Date.now() + 1000));
		scheduler.markFailure("codex", "second", 429, 1);
		jest.setSystemTime(new Date(Date.now() + 1000));
		scheduler.markFailure("codex", "third", 429, 1);
		const accounts = [first, second, third];
		expect(scheduler.select("codex", "", accounts).account.id).toBe("first");
		// 再失败一次 first 就把它推到队尾，下一次轮到第二远的 second。
		scheduler.markFailure("codex", "first", 429, 1);
		expect(scheduler.select("codex", "", accounts).account.id).toBe("second");
	} finally {
		jest.useRealTimers();
	}
});

it("额度闸门挡住的账号不参与调度，全部被挡住时兜底放行", () => {
	const scheduler = new SubscriptionAccountScheduler({
		blocking: (source) => new Set(source === "codex" ? ["first"] : []),
	});
	const first = account("first");
	const second = account("second");
	for (let index = 0; index < 5; index += 1) {
		const selection = scheduler.select("codex", "", [first, second]);
		expect(selection.account.id).toBe("second");
		expect(selection.quotaFallback).toBeUndefined();
	}
	const blocked = new SubscriptionAccountScheduler({ blocking: () => new Set(["first", "second"]) });
	const fallback = blocked.select("codex", "", [first, second]);
	expect(fallback.quotaFallback).toBe(true);
});

it("重启后从落盘状态恢复最近失败时间", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const first = account("first");
	const second = account("second");
	scheduler.hydrateState([{ source: "codex", accountId: "first", lastFailureAt: Date.now() }]);
	for (let index = 0; index < 5; index += 1) {
		expect(scheduler.select("codex", "", [first, second]).account.id).toBe("second");
	}
	expect(scheduler.lastFailureAt("codex", "first")).toBeDefined();
});

it("全部账号冷却时返回 429", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const only = account("only");
	scheduler.markFailure("codex", "only", 429, 60_000);
	expect(() => scheduler.select("codex", "", [only])).toThrow(ApiError);
	try {
		scheduler.select("codex", "", [only]);
	} catch (error) {
		expect((error as ApiError).statusCode).toBe(429);
	}
});

it("429 只冷却被限流的模型，同账号其他模型仍可调度", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const only = account("only");
	scheduler.markFailure("opencode-go", "only", 429, 60_000, "hy4-flash-free");
	// 同一账号另一个模型不受影响：修复前按账号冷却，会把整个 Provider 拖下水
	expect(scheduler.select("opencode-go", "", [only], undefined, "deepseek-v4.1-flash").account.id).toBe("only");
	expect(() => scheduler.select("opencode-go", "", [only], undefined, "hy4-flash-free")).toThrow(ApiError);
	try {
		scheduler.select("opencode-go", "", [only], undefined, "hy4-flash-free");
	} catch (error) {
		expect((error as ApiError).statusCode).toBe(429);
		expect((error as ApiError).message).toContain("hy4-flash-free");
	}
});

it("凭证失败（401/403）仍按账号冷却，所有模型一起避开", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const only = account("only");
	scheduler.markFailure("opencode-go", "only", 401, undefined, "hy4-flash-free");
	expect(() => scheduler.select("opencode-go", "", [only], undefined, "deepseek-v4.1-flash")).toThrow(ApiError);
});

it("markSuccess 清掉该模型的冷却，其他模型冷却保持原样", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const only = account("only");
	scheduler.markFailure("opencode-go", "only", 429, 60_000, "model-a");
	scheduler.markFailure("opencode-go", "only", 429, 60_000, "model-b");
	scheduler.markSuccess("opencode-go", "only", "model-a");
	expect(scheduler.select("opencode-go", "", [only], undefined, "model-a").account.id).toBe("only");
	expect(() => scheduler.select("opencode-go", "", [only], undefined, "model-b")).toThrow(ApiError);
});
