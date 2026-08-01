/**
 * CostCalculator 测试
 */
import { costPerToken, lookupModelCostPerToken, ServiceTier } from "./CostCalculator";
import { modelCostMapService } from "./ModelCostMapService";

describe("costPerToken", () => {
	it("calculates deepseek-v4-flash cost correctly", () => {
		const result = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000);
		expect(result.inputCost).toBeCloseTo(0.14, 4);
		expect(result.outputCost).toBeCloseTo(0.28, 4);
	});

	it("calculates deepseek-v4-pro cost correctly", () => {
		const result = costPerToken("deepseek/deepseek-v4-pro", 1000000, 1000000);
		expect(result.inputCost).toBeCloseTo(0.435, 4);
		expect(result.outputCost).toBeCloseTo(0.87, 4);
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

	it("snapshot 未命中时仍为 llmux subscription models 返回 0 cost", () => {
		// bare format
		const r1 = costPerToken("claude-subscription-local-only", 1000000, 1000000);
		expect(r1.inputCost).toBe(0);
		expect(r1.outputCost).toBe(0);
		// provider-prefixed format
		const r2 = costPerToken("anthropic/claude-subscription-local-only", 1000000, 1000000);
		expect(r2.inputCost).toBe(0);
		expect(r2.outputCost).toBe(0);
	});

	it("handles zero tokens gracefully", () => {
		const result = costPerToken("deepseek/deepseek-v4-flash", 0, 0);
		expect(result.inputCost).toBe(0);
		expect(result.outputCost).toBe(0);
	});

	it("returns 0,0,0 for unknown model without custom_cost_per_token (GAP COST-001: align with PY silent fallback)", () => {
		// PY cost_calculator.py:2076-2077: `if not model_info: return 0.0, 0.0`
		// 之前 TS 抛错让调用方手动 catch；现按 PY 行为静默返回 0,0,0
		const result = costPerToken("unknown/model", 1000, 1000);
		expect(result.inputCost).toBe(0);
		expect(result.outputCost).toBe(0);
		expect(result.totalCost).toBe(0);
	});

	it("uses customCostPerToken override for unknown model", () => {
		const result = costPerToken("unknown/model", 1000, 1000, 0, 0, {
			customCostPerToken: {
				input_cost_per_token: 0.001,
				output_cost_per_token: 0.002,
			},
		});
		expect(result.inputCost).toBeCloseTo(1, 4);
		expect(result.outputCost).toBeCloseTo(2, 4);
	});

	describe("service_tier (DIFF-COST-01: no hardcoded multiplier, modelCostMap-driven)", () => {
		it("service_tier 默认 standard (无参数时不变)", () => {
			const noArg = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000);
			const standard = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Standard,
			});
			expect(noArg.totalCost).toBeCloseTo(standard.totalCost, 6);
		});

		it("service_tier='premium' 缺省 modelCostMap 不再加价 (对齐 PY 行为)", () => {
			// 修正旧断言：PY 中 premium 实际是 priority 别名，缺省 modelCostMap 字段
			// 时回退到 standard，不乘 2。
			const standard = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Standard,
			});
			const premium = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Premium,
			});
			// DIFF-COST-01: 缺省回退到 standard，totalCost 相等
			expect(premium.totalCost).toBeCloseTo(standard.totalCost, 6);
		});

		it("service_tier='flex' 缺省 modelCostMap 字段回退 standard (不折扣 50%)", () => {
			// DIFF-COST-01: 缺省时 input_cost_per_token_flex 字段缺失 → 回退 standard
			const standard = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Standard,
			});
			const flex = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Flex,
			});
			expect(flex.totalCost).toBeCloseTo(standard.totalCost, 6);
		});

		it("service_tier='flex' 配合 modelCostMap[model].input_cost_per_token_flex 字段生效", () => {
			// DIFF-COST-01: 联动 modelCostMap，flex 字段 0.0001/0.0002
			const modelCostMap = {
				"deepseek/deepseek-v4-flash": {
					input_cost_per_token: 0.0000005,
					output_cost_per_token: 0.000001,

					input_cost_per_token_flex: 0.0000001,

					output_cost_per_token_flex: 0.0000002,
				},
			};
			const flex = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Flex,
				modelCostMap: modelCostMap,
			});
			expect(flex.inputCost).toBeCloseTo(0.1, 6);
			expect(flex.outputCost).toBeCloseTo(0.2, 6);
		});

		it("service_tier='priority' 配合 modelCostMap[model].input_cost_per_token_priority 字段生效", () => {
			const modelCostMap = {
				"deepseek/deepseek-v4-flash": {
					input_cost_per_token: 0.0000005,
					output_cost_per_token: 0.000001,

					input_cost_per_token_priority: 0.000001,

					output_cost_per_token_priority: 0.000002,
				},
			};
			const priority = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Priority,
				modelCostMap: modelCostMap,
			});
			expect(priority.inputCost).toBeCloseTo(1.0, 6);
			expect(priority.outputCost).toBeCloseTo(2.0, 6);
		});

		it("service_tier='batch' 缺省回退 standard（PY 半价暂未实现 - GAP）", () => {
			// PY 走 output_cost_per_token_batches / 2；TS 暂未实现 batch 后缀字段
			// 现回退 standard（不折扣 50%）
			const standard = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Standard,
			});
			const batch = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				service_tier: ServiceTier.Batch,
			});
			expect(batch.totalCost).toBeCloseTo(standard.totalCost, 6);
		});
	});

	describe("modelCostMap 透传 (DIFF-COST-02)", () => {
		it("lookupModelCostPerToken 接受 modelCostMap 参数", () => {
			const modelCostMap = {
				"custom-model": {
					input_cost_per_token: 0.000_002,
					output_cost_per_token: 0.000_004,
				},
			};
			const cost = lookupModelCostPerToken("custom-model", modelCostMap);
			expect(cost?.input_cost_per_token).toBeCloseTo(0.000_002, 9);
			expect(cost?.output_cost_per_token).toBeCloseTo(0.000_004, 9);
		});

		it("costPerToken 接受 modelCostMap 透传 — 覆盖内置 PRICE_TABLE", () => {
			// 用户传入 modelCostMap 时优先用之
			const modelCostMap = {
				"deepseek/deepseek-v4-flash": {
					input_cost_per_token: 0.000_001,
					output_cost_per_token: 0.000_002,
				},
			};
			const r = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			expect(r.inputCost).toBeCloseTo(1.0, 4);
			expect(r.outputCost).toBeCloseTo(2.0, 4);
		});

		it("modelCostMap 不命中时回退内置 PRICE_TABLE", () => {
			const modelCostMap = {
				"some-other-model": { input_cost_per_token: 0, output_cost_per_token: 0 },
			};
			const r = costPerToken("deepseek/deepseek-v4-flash", 1000000, 1000000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			// 回退到当前 service snapshot 的 deepseek-v4-flash 价格
			expect(r.inputCost).toBeCloseTo(0.14, 4);
			expect(r.outputCost).toBeCloseTo(0.28, 4);
		});
	});

	describe("DIFF-003: reasoning_tokens 从 output 扣除 (PY cost_calculator.py:2093-2098)", () => {
		it("reasoning_tokens 从 output 中扣除，不计费", () => {
			// 1000 input + 1000 output - 300 reasoning = 700 计费
			const modelCostMap = {
				"test-model-reasoning": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
				},
			};
			const r = costPerToken("test-model-reasoning", 1_000_000, 1_000_000, 0, 0, {
				modelCostMap: modelCostMap,
				reasoningTokens: 300_000,
			});
			// 1M * 1e-6 = 1.0; output = (1M - 300k) * 2e-6 = 700k * 2e-6 = 1.4
			expect(r.inputCost).toBeCloseTo(1.0, 4);
			expect(r.outputCost).toBeCloseTo(1.4, 4);
		});

		it("reasoningTokens 缺省时 output 完整计费", () => {
			const modelCostMap = {
				"test-model-reasoning2": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
				},
			};
			const r = costPerToken("test-model-reasoning2", 1_000_000, 1_000_000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			expect(r.outputCost).toBeCloseTo(2.0, 4);
		});

		it("reasoningTokens 超过 completionTokens 时按 0 计（Math.max 兜底）", () => {
			const modelCostMap = {
				"test-model-reasoning3": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
				},
			};
			const r = costPerToken("test-model-reasoning3", 1_000_000, 100, 0, 0, {
				modelCostMap: modelCostMap,
				reasoningTokens: 500,
			});
			expect(r.outputCost).toBe(0);
		});
	});

	describe("DIFF-007: above_200k 阶梯定价 (PY utils.py:5709-5736)", () => {
		it("prompt_tokens > 200k 且 modelCostMap 提供 above_200k 字段时切换", () => {
			const modelCostMap = {
				"test-200k-model": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
					input_cost_per_token_above_200k_tokens: 2e-6,
					output_cost_per_token_above_200k_tokens: 4e-6,
				},
			};
			const r = costPerToken("test-200k-model", 250_000, 250_000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			// 250k * 2e-6 = 0.5
			expect(r.inputCost).toBeCloseTo(0.5, 4);
			expect(r.outputCost).toBeCloseTo(1.0, 4);
		});

		it("prompt_tokens <= 200k 时不切换到 above_200k", () => {
			const modelCostMap = {
				"test-200k-model2": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
					input_cost_per_token_above_200k_tokens: 2e-6,
					output_cost_per_token_above_200k_tokens: 4e-6,
				},
			};
			const r = costPerToken("test-200k-model2", 100_000, 100_000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			// 用 standard 1e-6 / 2e-6
			expect(r.inputCost).toBeCloseTo(0.1, 4);
			expect(r.outputCost).toBeCloseTo(0.2, 4);
		});

		it("prompt_tokens > 200k 但无 above_200k 字段时回退 standard", () => {
			const modelCostMap = {
				"test-200k-model3": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
				},
			};
			const r = costPerToken("test-200k-model3", 250_000, 250_000, 0, 0, {
				modelCostMap: modelCostMap,
			});
			expect(r.inputCost).toBeCloseTo(0.25, 4);
			expect(r.outputCost).toBeCloseTo(0.5, 4);
		});

		it("above_200k 命中时 cache 也用 above_200k 单价", () => {
			const modelCostMap = {
				"test-200k-cache": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
					input_cost_per_token_above_200k_tokens: 1e-6,
					output_cost_per_token_above_200k_tokens: 2e-6,
					cache_creation_input_token_cost: 0.5e-6,
					cache_read_input_token_cost: 0.05e-6,
					cache_creation_input_token_cost_above_200k_tokens: 1.0e-6,
					cache_read_input_token_cost_above_200k_tokens: 0.1e-6,
				},
			};
			const r = costPerToken("test-200k-cache", 250_000, 100_000, 10_000, 5_000, {
				modelCostMap: modelCostMap,
			});
			// cache 走 above_200k 字段: 10k * 1.0 / 1M = 0.01, 5k * 0.1 / 1M = 0.0005
			expect(r.cacheInputCost).toBeCloseTo(0.0105, 6);
			expect(r.totalCost).toBeGreaterThan(0);
		});
	});

	describe("DIFF-COST-02: batch tier half-price", () => {
		it("tier=batch + 提供 batches 字段时 output * 0.5", () => {
			const modelCostMap = {
				"test-model": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
					input_cost_per_token_batches: 1e-6,
					output_cost_per_token_batches: 2e-6,
				},
			};
			const r = costPerToken("test-model", 1_000_000, 1_000_000, 0, 0, {
				modelCostMap: modelCostMap,
				service_tier: ServiceTier.Batch,
			});
			// input 走 batches 字段，output 走 batches 字段 * 0.5
			expect(r.inputCost).toBeCloseTo(1.0, 4);
			expect(r.outputCost).toBeCloseTo(1.0, 4); // 1M * 2e-6 * 0.5
		});

		it("tier=batch 但无 batches 字段 → 回退 standard，不应用 0.5 折扣", () => {
			const modelCostMap = {
				"test-model": {
					input_cost_per_token: 1e-6,
					output_cost_per_token: 2e-6,
				},
			};
			const r = costPerToken("test-model", 1_000_000, 1_000_000, 0, 0, {
				modelCostMap: modelCostMap,
				service_tier: ServiceTier.Batch,
			});
			expect(r.inputCost).toBeCloseTo(1.0, 4);
			expect(r.outputCost).toBeCloseTo(2.0, 4);
		});

		describe("统一实时价格 snapshot", () => {
			afterEach(() => {
				jest.restoreAllMocks();
			});

			it("未显式传 map 时每次读取当前 service snapshot", () => {
				const getSnapshot = jest.spyOn(modelCostMapService, "getSnapshot");
				getSnapshot.mockReturnValue({
					map: { dynamic: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } },
					rawJson: "{}",
					source: "remote",
					url: "https://prices.test",
					isEnvForced: false,
					fallbackReason: null,
					modelCount: 1,
					loadedAt: "2026-01-01T00:00:00.000Z",
				});
				expect(costPerToken("dynamic", 1_000_000, 1_000_000).totalCost).toBeCloseTo(3);

				getSnapshot.mockReturnValue({
					map: { dynamic: { input_cost_per_token: 3e-6, output_cost_per_token: 4e-6 } },
					rawJson: "{}",
					source: "remote",
					url: "https://prices.test",
					isEnvForced: false,
					fallbackReason: null,
					modelCount: 1,
					loadedAt: "2026-01-01T01:00:00.000Z",
				});
				expect(costPerToken("dynamic", 1_000_000, 1_000_000).totalCost).toBeCloseTo(7);
			});

			it("显式 modelCostMap override 优先于 service snapshot", () => {
				jest.spyOn(modelCostMapService, "getSnapshot").mockReturnValue({
					map: { dynamic: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } },
					rawJson: "{}",
					source: "remote",
					url: "https://prices.test",
					isEnvForced: false,
					fallbackReason: null,
					modelCount: 1,
					loadedAt: "2026-01-01T00:00:00.000Z",
				});
				const result = costPerToken("dynamic", 1_000_000, 1_000_000, 0, 0, {
					modelCostMap: { dynamic: { input_cost_per_token: 8e-6, output_cost_per_token: 9e-6 } },
				});
				expect(result.totalCost).toBeCloseTo(17);
			});
		});
	});
});
