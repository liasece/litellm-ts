import { describe, expect, it } from "vitest";
import { addDiscount, addMargin, aggregateEstimates, estimateRequest } from "./CostTrackingLogic";
import type { CostEstimateResponse, EntryEstimate, ModelEntry } from "../support/CostTrackingModels";
const entry: ModelEntry = { id: "one", model: "test-model", input_tokens: 1000, output_tokens: 500, num_requests_per_day: 0 };
describe("cost tracking request contracts", () => {
	it("converts percentage inputs to provider fractions and preserves fixed amounts", () => {
		expect(addDiscount({}, "OpenAI", "5")).toEqual({ provider: "openai", value: 0.05 });
		expect(
			addMargin({}, { selectedProvider: "global", marginType: "percentage", percentageValue: "10", fixedAmountValue: "" }),
		).toEqual({ provider: "global", value: 0.1 });
		expect(addMargin({}, { selectedProvider: "OpenAI", marginType: "fixed", percentageValue: "", fixedAmountValue: ".001" })).toEqual({
			provider: "openai",
			value: { fixed_amount: 0.001 },
		});
	});
	it("retains the existing validation ranges and duplicate-provider behavior", () => {
		expect(() => addDiscount({ openai: 0.1 }, "OpenAI", "5")).toThrow("already exists");
		expect(() => addDiscount({}, "OpenAI", "101")).toThrow("0% and 100%");
		expect(() =>
			addMargin({}, { selectedProvider: "global", marginType: "percentage", percentageValue: "1001", fixedAmountValue: "" }),
		).toThrow("0% and 1000%");
	});
	it("sends omitted request volumes as null and preserves explicit token zero", () => {
		expect(estimateRequest({ ...entry, input_tokens: 0 })).toEqual({
			model: "test-model",
			input_tokens: 0,
			output_tokens: 500,
			num_requests_per_day: null,
			num_requests_per_month: null,
		});
	});
	it("sums available model results without converting absent period estimates to zero", () => {
		const response: CostEstimateResponse = {
			model: "test-model",
			input_tokens: 1000,
			output_tokens: 500,
			num_requests_per_day: null,
			num_requests_per_month: 100,
			cost_per_request: 0.1,
			input_cost_per_request: 0.02,
			output_cost_per_request: 0.07,
			margin_cost_per_request: 0.01,
			daily_cost: null,
			daily_input_cost: null,
			daily_output_cost: null,
			daily_margin_cost: null,
			monthly_cost: 10,
			monthly_input_cost: 2,
			monthly_output_cost: 7,
			monthly_margin_cost: 1,
			input_cost_per_token: 0.00002,
			output_cost_per_token: 0.00014,
			provider: "openai",
		};
		const cache = new Map<string, EntryEstimate>([["one", { entry, result: response, loading: false, error: null }]]);
		const total = aggregateEstimates([entry, { ...entry, id: "two" }], cache);
		expect(total.totals).toEqual({
			cost_per_request: 0.1,
			daily_cost: null,
			monthly_cost: 10,
			margin_per_request: 0.01,
			daily_margin: null,
			monthly_margin: 1,
		});
		expect(total.entries[1].result).toBeNull();
	});
});
