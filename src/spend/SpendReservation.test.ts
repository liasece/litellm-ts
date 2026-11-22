import type { Request } from "express";
import * as SpendTracker from "./SpendTracker";
import { chooseReservationAmount, estimateRouterSpendReservation, estimateRouterSpendReservationUpperBound } from "./SpendReservation";

function deployment(modelName: string, model: string, cost: { input: number; output: number }): Record<string, unknown> {
	return {
		model_name: modelName,
		litellm_params: { model: model },
		model_info: { input_cost_per_token: cost.input, output_cost_per_token: cost.output },
	};
}

function routerOf(deployments: Record<string, unknown>[], fallbacks: Record<string, string[]> = {}): never {
	return {
		getDeployments: () => deployments,
		getFallbacks: () => fallbacks,
	} as never;
}

const BODY: Record<string, unknown> = { prompt: "hello world", max_tokens: 10 };

describe("Spend reservation 估算优化", () => {
	afterEach(() => jest.restoreAllMocks());

	it("相同价格特征的候选只计算一次，结果与逐候选最大值一致", () => {
		const deployments = [
			...Array.from({ length: 20 }, () => deployment("primary", "provider/cheap", { input: 0.01, output: 0.02 })),
			deployment("fallback", "provider/expensive", { input: 0.4, output: 0.5 }),
		];
		const router = routerOf(deployments);
		const expensive = SpendTracker.estimateSpendReservation("provider/expensive", BODY, {
			input_cost_per_token: 0.4,
			output_cost_per_token: 0.5,
		});
		expect(estimateRouterSpendReservation(router, "primary", BODY)).toBe(expensive);
	});

	it("整次估算只做一次请求体度量与分词", () => {
		const measure = jest.spyOn(SpendTracker, "measureReservationPrompt");
		const router = routerOf([
			deployment("primary", "provider/cheap", { input: 0.01, output: 0.02 }),
			deployment("primary-2", "provider/mid", { input: 0.02, output: 0.03 }),
		]);
		estimateRouterSpendReservation(router, "primary", BODY);
		expect(measure).toHaveBeenCalledTimes(1);
		expect(measure.mock.calls[0]?.[1]).toBeUndefined();
	});

	it("按字节的上界不低于精确口径", () => {
		const router = routerOf([deployment("primary", "provider/cheap", { input: 0.01, output: 0.02 })]);
		const exact = estimateRouterSpendReservation(router, "primary", BODY);
		const upperBound = estimateRouterSpendReservationUpperBound(router, "primary", BODY);
		expect(upperBound).toBeGreaterThanOrEqual(exact - 1e-9);
	});

	describe("chooseReservationAmount", () => {
		const router = routerOf([deployment("primary", "provider/cheap", { input: 0.01, output: 0.02 })]);

		it("没有预算守卫时按精确口径预留", () => {
			expect(chooseReservationAmount(router, "primary", BODY, undefined)).toBe(
				estimateRouterSpendReservation(router, "primary", BODY),
			);
		});

		it("余量不足时仍走精确口径", () => {
			const exact = estimateRouterSpendReservation(router, "primary", BODY);
			const chosen = chooseReservationAmount(router, "primary", BODY, { budgeted: true, headroom: exact, exhaustedScope: null });
			expect(chosen).toBe(exact);
		});

		it("余量远高于上界时跳过精确分词，直接按字节上界预留", () => {
			const measure = jest.spyOn(SpendTracker, "measureReservationPrompt");
			const upperBound = estimateRouterSpendReservationUpperBound(router, "primary", BODY);
			measure.mockClear();
			const chosen = chooseReservationAmount(router, "primary", BODY, {
				budgeted: true,
				headroom: upperBound * 10,
				exhaustedScope: null,
			});
			expect(chosen).toBe(upperBound);
			expect(measure).toHaveBeenCalledTimes(1);
			expect(measure.mock.calls[0]?.[1]).toEqual({ skipTokenization: true });
		});
	});

	it("无预算主体时 reserveEndpointSpend 不估算也不写预留行", async () => {
		const request = {
			headers: {},
			auth: { api_key: "key", budget_snapshots: {} },
			budgetGuard: { budgeted: false, headroom: null, exhaustedScope: null },
		} as unknown as Request;
		const estimate = jest.spyOn(SpendTracker, "estimateSpendReservation");
		const reserve = jest.spyOn(SpendTracker, "reserveSpend");
		const db = {} as never;
		const { reserveEndpointSpend } = await import("./SpendReservation");
		await expect(
			reserveEndpointSpend(
				db,
				routerOf([deployment("primary", "provider/cheap", { input: 0.01, output: 0.02 })]),
				request,
				"primary",
				BODY,
			),
		).resolves.toEqual(expect.objectContaining({ requestId: expect.any(String) }));
		expect(estimate).not.toHaveBeenCalled();
		expect(reserve).not.toHaveBeenCalled();
	});
});
