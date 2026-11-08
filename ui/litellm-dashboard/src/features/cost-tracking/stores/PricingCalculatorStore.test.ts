import { afterEach, describe, expect, it, vi } from "vitest";
import { createPricingCalculatorStore } from "./PricingCalculatorStore";
import type { CostEstimateResponse } from "../support/CostTrackingModels";

function result(model: string, cost: number): CostEstimateResponse {
	return {
		model,
		input_tokens: 1000,
		output_tokens: 500,
		num_requests_per_day: null,
		num_requests_per_month: null,
		cost_per_request: cost,
		input_cost_per_request: cost,
		output_cost_per_request: 0,
		margin_cost_per_request: 0,
		daily_cost: null,
		daily_input_cost: null,
		daily_output_cost: null,
		daily_margin_cost: null,
		monthly_cost: null,
		monthly_input_cost: null,
		monthly_output_cost: null,
		monthly_margin_cost: null,
		input_cost_per_token: 0.000002,
		output_cost_per_token: 0.000008,
		provider: "openai",
	};
}
afterEach(() => vi.useRealTimers());
describe("pricing estimator async lifecycle", () => {
	it("ignores a slow result after the entry changes again", async () => {
		vi.useFakeTimers();
		let resolveOld: (value: CostEstimateResponse) => void = () => undefined;
		const estimate = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<CostEstimateResponse>((resolve) => {
						resolveOld = resolve;
					}),
			)
			.mockResolvedValue(result("new-model", 2));
		const store = createPricingCalculatorStore({ estimate }),
			id = store.state.entries[0].id;
		store.change(id, "model", "old-model");
		await vi.advanceTimersByTimeAsync(500);
		store.change(id, "model", "new-model");
		await vi.advanceTimersByTimeAsync(500);
		resolveOld(result("old-model", 99));
		await Promise.resolve();
		expect(store.result.value.entries[0].result?.model).toBe("new-model");
		expect(estimate).toHaveBeenCalledTimes(2);
		store.dispose();
	});
	it("cancels removed entries so their delayed result cannot reappear in totals", async () => {
		vi.useFakeTimers();
		let resolve: (value: CostEstimateResponse) => void = () => undefined;
		const estimate = vi.fn().mockImplementation(
			() =>
				new Promise<CostEstimateResponse>((done) => {
					resolve = done;
				}),
		);
		const store = createPricingCalculatorStore({ estimate });
		store.add();
		const id = store.state.entries[1].id;
		store.change(id, "model", "remove-me");
		await vi.advanceTimersByTimeAsync(500);
		const signal = estimate.mock.calls[0][1] as AbortSignal;
		expect(signal.aborted).toBe(false);
		store.remove(id);
		expect(signal.aborted).toBe(true);
		resolve(result("remove-me", 9));
		await Promise.resolve();
		expect(store.result.value.entries).toHaveLength(1);
		expect(store.result.value.totals.cost_per_request).toBe(0);
		store.dispose();
	});
});
