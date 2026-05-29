/**
 * CostCalculator 测试
 */
import { costPerToken } from "./CostCalculator";

describe("costPerToken", () => {
	it("calculates deepseek-v4-flash cost correctly", () => {
		const result = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000);
		expect(result.inputCost).toBeCloseTo(0.5, 1);
		expect(result.outputCost).toBeCloseTo(1.0, 1);
	});

	it("calculates deepseek-v4-pro cost correctly", () => {
		const result = costPerToken("deepseek/deepseek-v4-pro", 1000000, 1000000);
		expect(result.inputCost).toBeCloseTo(1.75, 2);
		expect(result.outputCost).toBeCloseTo(3.5, 2);
	});

	it("calculates glm-5.1 cost correctly", () => {
		const result = costPerToken("glm/GLM-5.1", 500000, 500000);
		expect(result.inputCost).toBeCloseTo(0.585, 2);
		expect(result.outputCost).toBeCloseTo(2.04, 1);
	});

	it("calculates mimo-v2.5-pro cost correctly", () => {
		const result = costPerToken("mimo/mimo-v2.5-pro", 1000000, 1000000);
		expect(result.inputCost).toBeCloseTo(1.02, 2);
		expect(result.outputCost).toBeCloseTo(3.06, 2);
	});

	it("returns 0 cost for llmux subscription models", () => {
		// bare format
		const r1 = costPerToken("claude-sonnet-4-6", 1000000, 1000000);
		expect(r1.inputCost).toBe(0);
		expect(r1.outputCost).toBe(0);
		// provider-prefixed format
		const r2 = costPerToken("anthropic/claude-sonnet-4-6", 1000000, 1000000);
		expect(r2.inputCost).toBe(0);
		expect(r2.outputCost).toBe(0);
	});

	it("handles zero tokens gracefully", () => {
		const result = costPerToken("deepseek/deepseek-v4-flash", 0, 0);
		expect(result.inputCost).toBe(0);
		expect(result.outputCost).toBe(0);
	});

	it("handles unknown model with default pricing", () => {
		const result = costPerToken("unknown/model", 1000, 1000);
		expect(typeof result.inputCost).toBe("number");
		expect(typeof result.outputCost).toBe("number");
	});
});
