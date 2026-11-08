/**
 * 费用折扣 / 保证金配置与调整的单元测试。
 *
 * 锁定对外契约：
 * - PATCH 请求体的校验规则（provider 集合、折扣 0..1、保证金 0..10 / 固定金额非负）；
 * - 历史脏配置的宽容读取（单条非法不影响其它条目）；
 * - 费用应用顺序：先折扣、后保证金，provider 命中优先于 global；
 * - 进程内快照的读写。
 */
import { ApiError } from "../core/api/ApiError";
import {
	applyCostDiscount,
	applyCostMargin,
	adjustCost,
	costTrackingConfigService,
	normalizeDiscountConfig,
	normalizeMarginConfig,
	readDiscountConfig,
	readMarginConfig,
	resolveCostProvider,
} from "./CostTrackingConfig";

describe("normalizeDiscountConfig", () => {
	it("accepts discount fractions between 0 and 1 and sorts providers", () => {
		expect(normalizeDiscountConfig({ openai: 0.5, cliproxy: 0 })).toEqual({ cliproxy: 0, openai: 0.5 });
	});

	it("rejects providers this deployment does not run, listing valid ones", () => {
		expect(() => normalizeDiscountConfig({ groq: 0.1 })).toThrow(ApiError);
		expect(() => normalizeDiscountConfig({ groq: 0.1 })).toThrow(/Invalid provider\(s\): groq/);
		// 错误信息要让用户知道本部署可配置哪些 provider
		expect(() => normalizeDiscountConfig({ groq: 0.1 })).toThrow(/cliproxy/);
	});

	it("rejects non-numeric and out-of-range discounts", () => {
		expect(() => normalizeDiscountConfig({ openai: "0.1" })).toThrow(/must be a number/);
		expect(() => normalizeDiscountConfig({ openai: 1.5 })).toThrow(/between 0 and 1/);
		expect(() => normalizeDiscountConfig({ openai: -0.1 })).toThrow(/between 0 and 1/);
		expect(() => normalizeDiscountConfig(null)).toThrow(/must be an object/);
	});
});

describe("normalizeMarginConfig", () => {
	it("accepts numeric percentages and percentage/fixed_amount objects", () => {
		expect(normalizeMarginConfig({ deepseek: 0.05, global: { percentage: 0.1, fixed_amount: 0.0001 } })).toEqual({
			deepseek: 0.05,
			global: { fixed_amount: 0.0001, percentage: 0.1 },
		});
	});

	it("rejects unknown providers but allows the global fallback key", () => {
		expect(() => normalizeMarginConfig({ unknown_provider: 0.1 })).toThrow(/Invalid provider\(s\): unknown_provider/);
		expect(normalizeMarginConfig({ global: 0 })).toEqual({ global: 0 });
	});

	it("rejects out-of-range percentages and negative fixed amounts", () => {
		expect(() => normalizeMarginConfig({ openai: 11 })).toThrow(/between 0 and 10/);
		expect(() => normalizeMarginConfig({ openai: { percentage: -1 } })).toThrow(/between 0 and 10/);
		expect(() => normalizeMarginConfig({ openai: { fixed_amount: -0.5 } })).toThrow(/non-negative/);
		expect(() => normalizeMarginConfig({ openai: { percentage: "1" } })).toThrow(/must be a number/);
		expect(() => normalizeMarginConfig({ openai: {} })).toThrow(/must be a number \(percentage\)/);
	});
});

describe("read*Config", () => {
	it("keeps valid entries and drops invalid ones instead of failing the whole config", () => {
		expect(readDiscountConfig({ openai: 0.2, groq: 0.5, deepseek: 3 })).toEqual({ openai: 0.2 });
		expect(readMarginConfig({ openai: 0.2, global: { percentage: 0.3 }, groq: 0.5, anthropic: { fixed_amount: -1 } })).toEqual({
			openai: 0.2,
			global: { percentage: 0.3 },
		});
	});

	it("returns an empty config for non-object values", () => {
		expect(readDiscountConfig(undefined)).toEqual({});
		expect(readMarginConfig("nope")).toEqual({});
	});
});

describe("resolveCostProvider", () => {
	it("prefers the explicit provider and otherwise uses the model prefix", () => {
		expect(resolveCostProvider("cliproxy", "glm-5.2")).toBe("cliproxy");
		expect(resolveCostProvider(undefined, "openai/gpt-5")).toBe("openai");
		expect(resolveCostProvider("", "gpt-5")).toBe("");
	});
});

describe("cost adjustments", () => {
	it("applies a provider discount as a fraction of the base cost", () => {
		expect(applyCostDiscount(10, "deepseek", { deepseek: 0.2 })).toEqual({ cost: 8, percent: 0.2, amount: 2 });
		expect(applyCostDiscount(10, "openai", { deepseek: 0.2 })).toEqual({ cost: 10, percent: 0, amount: 0 });
	});

	it("prefers the provider margin over the global fallback and supports both margin forms", () => {
		expect(applyCostMargin(10, "cliproxy", { cliproxy: 0.1, global: 0.5 })).toEqual({
			cost: 11,
			percent: 0.1,
			fixedAmount: 0,
			amount: 1,
		});
		expect(applyCostMargin(10, "openai", { global: { percentage: 0.1, fixed_amount: 1 } })).toEqual({
			cost: 12,
			percent: 0.1,
			fixedAmount: 1,
			amount: 2,
		});
	});

	it("applies discount before margin so the margin percentage uses the discounted amount", () => {
		const adjustment = adjustCost(10, "cliproxy", { discount: { cliproxy: 0.5 }, margin: { global: 0.1 } });
		expect(adjustment.total).toBeCloseTo(5.5, 10);
		expect(adjustment.discountAmount).toBeCloseTo(5, 10);
		expect(adjustment.marginAmount).toBeCloseTo(0.5, 10);
		expect(adjustment.marginPercent).toBe(0.1);
	});

	it("leaves zero-cost requests untouched", () => {
		expect(adjustCost(0, "cliproxy", { discount: { cliproxy: 1 }, margin: { global: 0.5 } })).toEqual({
			total: 0,
			discountPercent: 0,
			discountAmount: 0,
			marginPercent: 0,
			marginFixedAmount: 0,
			marginAmount: 0,
		});
	});
});

describe("costTrackingConfigService", () => {
	afterEach(() => {
		costTrackingConfigService.reset();
	});

	it("serves the values applied by the latest config write", () => {
		costTrackingConfigService.setValues({ openai: 0.5 }, { global: 0.1 });
		expect(costTrackingConfigService.getSnapshot()).toEqual({ discount: { openai: 0.5 }, margin: { global: 0.1 } });
	});
});
