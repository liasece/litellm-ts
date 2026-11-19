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

it("失败账号在冷却窗口内被跳过", () => {
	const scheduler = new SubscriptionAccountScheduler();
	const first = account("first");
	const second = account("second");
	scheduler.markFailure("codex", "first", 429, 60_000);
	for (let index = 0; index < 5; index += 1) {
		expect(scheduler.select("codex", "", [first, second]).account.id).toBe("second");
	}
	scheduler.markSuccess("codex", "first");
	expect(scheduler.select("codex", "", [first, second]).account.id).toBe("first");
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
