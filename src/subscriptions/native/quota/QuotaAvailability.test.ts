/**
 * 额度可用性判定的单元测试。
 *
 * 这些用例对应 2026-11-19 的线上问题：CommandCode 周额度用尽后，调度器只按一次失败
 * 冷却几十秒，于是每个请求都先撞空账号。这里验证「额度用尽 = 到重置时间前都跳过」，
 * 以及不知道额度时不会误杀账号。
 */

import { QuotaAvailability, DEFAULT_EXHAUSTION_MS, MAX_EXHAUSTION_MS } from "./QuotaAvailability";
import type { SubscriptionQuotaSnapshot } from "../types";

/**
 * 构造额度快照。
 * @param windows - 窗口列表
 * @param extra - 其他字段
 */
function snapshot(
	windows: readonly { name: string; remainingFraction?: number; resetTime?: string }[],
	extra: Partial<SubscriptionQuotaSnapshot> = {},
): SubscriptionQuotaSnapshot {
	return { windows: windows, fetchedAt: new Date().toISOString(), ...extra };
}

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date("2026-11-19T00:00:00Z"));
});

afterEach(() => {
	jest.useRealTimers();
});

it("周额度用尽后账号在重置时间前不可用，到期自动恢复", () => {
	const gate = new QuotaAvailability();
	const reset = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
	gate.applySnapshot("commandcode", "a", snapshot([{ name: "weekly", remainingFraction: 0, resetTime: reset }]));
	expect(gate.blocked("commandcode").has("a")).toBe(true);
	jest.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
	expect(gate.blocked("commandcode").has("a")).toBe(true);
	jest.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
	expect(gate.blocked("commandcode").has("a")).toBe(false);
});

it("还有额度的窗口让账号保持可用", () => {
	const gate = new QuotaAvailability();
	gate.markExhausted("commandcode", "a", Date.now() + 60 * 60 * 1000, "额度耗尽");
	expect(gate.blocked("commandcode").has("a")).toBe(true);
	gate.applySnapshot("commandcode", "a", snapshot([{ name: "weekly", remainingFraction: 0.4 }]));
	expect(gate.blocked("commandcode").has("a")).toBe(false);
});

it("额度查询失败不动已有状态：不知道不等于有额度", () => {
	const gate = new QuotaAvailability();
	const reset = Date.now() + 60 * 60 * 1000;
	gate.markExhausted("commandcode", "a", reset, "额度耗尽");
	gate.applySnapshot("commandcode", "a", snapshot([], { error: "upstream 502" }));
	expect(gate.state("commandcode", "a")?.exhaustedUntil).toBe(reset);
});

it("多个窗口同时用尽时等到最晚的重置时间", () => {
	const gate = new QuotaAvailability();
	const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
	const later = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
	gate.applySnapshot(
		"commandcode",
		"a",
		snapshot([
			{ name: "five_hour", remainingFraction: 0, resetTime: soon },
			{ name: "weekly", remainingFraction: 0, resetTime: later },
		]),
	);
	expect(gate.state("commandcode", "a")?.exhaustedUntil).toBe(Date.parse(later));
});

it("没有重置时间时按默认时长，且不超过上限", () => {
	const gate = new QuotaAvailability();
	gate.applySnapshot("opencode-go", "a", snapshot([{ name: "weekly", remainingFraction: 0 }]));
	expect(gate.state("opencode-go", "a")?.exhaustedUntil).toBe(Date.now() + DEFAULT_EXHAUSTION_MS);

	gate.markExhausted("opencode-go", "b", Date.now() + 30 * 24 * 60 * 60 * 1000, "额度耗尽");
	expect(gate.state("opencode-go", "b")?.exhaustedUntil).toBe(Date.now() + MAX_EXHAUSTION_MS);
});

it("重置时间已经过去时至少保持一分钟，避免立刻反复重试", () => {
	const gate = new QuotaAvailability();
	gate.markExhausted("commandcode", "a", Date.now() - 60_000, "额度耗尽");
	expect(gate.blocked("commandcode").has("a")).toBe(true);
	jest.setSystemTime(new Date(Date.now() + 61_000));
	expect(gate.blocked("commandcode").has("a")).toBe(false);
});

it("落盘状态可以恢复，过期条目被忽略", () => {
	const gate = new QuotaAvailability();
	const valid = Date.now() + 60 * 60 * 1000;
	gate.hydrate([
		{ source: "commandcode", accountId: "a", exhaustedUntil: valid, reason: "额度耗尽", observedAt: Date.now() },
		{ source: "commandcode", accountId: "b", exhaustedUntil: Date.now() - 1, reason: "额度耗尽", observedAt: Date.now() - 5000 },
	]);
	expect(gate.blocked("commandcode").has("a")).toBe(true);
	expect(gate.blocked("commandcode").has("b")).toBe(false);
});

it("markAvailable 清掉占位并报告是否真的清了", () => {
	const gate = new QuotaAvailability();
	gate.markExhausted("commandcode", "a", Date.now() + 60 * 60 * 1000, "额度耗尽");
	expect(gate.markAvailable("commandcode", "a")).toBe(true);
	expect(gate.markAvailable("commandcode", "a")).toBe(false);
});
