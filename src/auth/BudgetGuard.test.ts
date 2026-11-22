import { evaluateBudgetGuard, isBudgetGuardedRoute } from "./BudgetGuard";
import type { UserAPIKeyAuth } from "../types/auth";

function authWithSnapshots(overrides: Partial<UserAPIKeyAuth>): UserAPIKeyAuth {
	return overrides as UserAPIKeyAuth;
}

describe("BudgetGuard", () => {
	describe("evaluateBudgetGuard", () => {
		it("没有预算主体时不进入预算判定", () => {
			const decision = evaluateBudgetGuard(undefined);
			expect(decision).toEqual({ budgeted: false, headroom: null, exhaustedScope: null });
		});

		it("快照里没有硬上限时视为无预算", () => {
			const decision = evaluateBudgetGuard(
				authWithSnapshots({
					budget_snapshots: {
						key: { id: "k1", spend: 10, max_budget: null },
						team: { id: "t1", spend: 99, max_budget: null },
					},
				}),
			);
			expect(decision.budgeted).toBe(false);
			expect(decision.headroom).toBeNull();
		});

		it("取所有预算主体中余量最小者", () => {
			const decision = evaluateBudgetGuard(
				authWithSnapshots({
					budget_snapshots: {
						key: { id: "k1", spend: 1, max_budget: 100 },
						team: { id: "t1", spend: 30, max_budget: 40 },
						user: { id: "u1", spend: 5, max_budget: 500 },
					},
				}),
			);
			expect(decision.budgeted).toBe(true);
			expect(decision.headroom).toBeCloseTo(10, 10);
			expect(decision.exhaustedScope).toBeNull();
		});

		it("余量耗尽时给出主体键", () => {
			const decision = evaluateBudgetGuard(
				authWithSnapshots({
					budget_snapshots: {
						key: { id: "k1", spend: 100, max_budget: 100 },
						team: { id: "t1", spend: 1, max_budget: 40 },
					},
				}),
			);
			expect(decision.headroom).toBeCloseTo(0, 10);
			expect(decision.exhaustedScope).toBe("key");
		});

		it("缺少快照时回退到 key 级 max_budget", () => {
			const decision = evaluateBudgetGuard(authWithSnapshots({ spend: 2.5, max_budget: 10 }));
			expect(decision.budgeted).toBe(true);
			expect(decision.headroom).toBeCloseTo(7.5, 10);
		});

		it("非有限余量不参与判定", () => {
			const decision = evaluateBudgetGuard(
				authWithSnapshots({
					budget_snapshots: {
						key: { id: "k1", spend: 0, max_budget: Number.POSITIVE_INFINITY },
						team: { id: "t1", spend: 4, max_budget: 10 },
					},
				}),
			);
			expect(decision.headroom).toBeCloseTo(6, 10);
		});
	});

	describe("isBudgetGuardedRoute", () => {
		it("覆盖推理端点并排除元数据端点", () => {
			expect(isBudgetGuardedRoute("/v1/messages")).toBe(true);
			expect(isBudgetGuardedRoute("/v1/messages/count_tokens")).toBe(true);
			expect(isBudgetGuardedRoute("/v1/chat/completions")).toBe(true);
			expect(isBudgetGuardedRoute("/responses")).toBe(true);
			expect(isBudgetGuardedRoute("/v1/models")).toBe(false);
			expect(isBudgetGuardedRoute("/v1/model/info")).toBe(false);
		});
	});
});
