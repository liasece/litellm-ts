/**
 * 单价快照：费用日志必须能还原「这次请求按什么价、价从哪来」。
 * 上游调价或配置改动后，历史行不应被重新解释。
 */
import { buildPriceSnapshot, chargedUnitPrices } from "./PriceSnapshot";
import type { AppliedPrices } from "../cost/CostCalculator";

const prices: AppliedPrices = {
	input_cost_per_token: { per_token: 1.4e-6, source: "upstream" },
	output_cost_per_token: { per_token: 4.4e-6, source: "config" },
	cache_read_input_token_cost: { per_token: 2.6e-7, source: "model_cost_map" },
	cache_creation_input_token_cost: { per_token: 0, source: "unset" },
};

describe("buildPriceSnapshot", () => {
	it("records the applied unit prices with their sources and drops unset fields", () => {
		const snapshot = buildPriceSnapshot(prices, undefined, 1);
		expect(snapshot).toEqual({
			unit_prices: { input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6, cache_read_input_token_cost: 2.6e-7 },
			sources: { input_cost_per_token: "upstream", output_cost_per_token: "config", cache_read_input_token_cost: "model_cost_map" },
		});
	});

	it("freezes the upstream catalog (source, model, fetch time, prices) with the request", () => {
		const snapshot = buildPriceSnapshot(
			prices,
			{
				upstream_catalog: {
					source: "opencode-go",
					upstream_model: "glm-5.3",
					fetched_at: "2026-11-18T10:40:00.000Z",
					unit_prices: { input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6 },
				},
			},
			1,
		);
		expect(snapshot?.upstream).toEqual({
			source: "opencode-go",
			upstream_model: "glm-5.3",
			fetched_at: "2026-11-18T10:40:00.000Z",
			unit_prices: { input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6 },
		});
	});

	it("omits the upstream catalog when no price came from upstream", () => {
		// 订阅部署通常也缓存了上游元信息，但配置价已足够时它并未参与计费；
		// 记下来只会让费用详情误以为这笔钱按上游价结算。
		const snapshot = buildPriceSnapshot(
			{ input_cost_per_token: { per_token: 1e-6, source: "config" } },
			{
				upstream_catalog: {
					source: "commandcode",
					upstream_model: "deepseek/deepseek-v4.1-flash",
					fetched_at: "2026-11-18T09:53:18.199Z",
					unit_prices: {},
				},
			},
			1,
		);
		expect(snapshot?.upstream).toBeUndefined();
		expect(snapshot?.sources).toEqual({ input_cost_per_token: "config" });
	});

	it("records peak tier and multiplier only when peak pricing is configured", () => {
		const peak = { windows: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" }], multiplier: 1.2 };
		expect(buildPriceSnapshot(prices, { peak_pricing: peak }, 1.2)?.peak).toEqual({ tier: "peak", multiplier: 1.2 });
		expect(buildPriceSnapshot(prices, undefined, 1)?.peak).toBeUndefined();
		expect(buildPriceSnapshot(prices, { peak_pricing: peak }, 1)?.peak).toEqual({ tier: "off_peak", multiplier: 1 });
	});

	it("charges every field at the frozen peak multiplier and keeps the base price in the snapshot", () => {
		// 结算列存实收价（基础价 × 倍率），快照仍保留基础价与档位，供费用气泡展示「基础价 ×2」。
		const peak = { windows: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" }], multiplier: 2 };
		const snapshot = buildPriceSnapshot(prices, { peak_pricing: peak }, 2);
		expect(chargedUnitPrices(snapshot)).toEqual({
			input_cost_per_token: 2.8e-6,
			output_cost_per_token: 8.8e-6,
			cache_read_input_token_cost: 5.2e-7,
		});
		expect(snapshot?.unit_prices).toEqual({
			input_cost_per_token: 1.4e-6,
			output_cost_per_token: 4.4e-6,
			cache_read_input_token_cost: 2.6e-7,
		});
	});

	it("keeps the base price when the request did not hit a peak window", () => {
		const peak = { windows: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" }], multiplier: 2 };
		expect(chargedUnitPrices(buildPriceSnapshot(prices, { peak_pricing: peak }, 1))).toEqual({
			input_cost_per_token: 1.4e-6,
			output_cost_per_token: 4.4e-6,
			cache_read_input_token_cost: 2.6e-7,
		});
	});

	it("returns nothing to charge when no price participated", () => {
		expect(chargedUnitPrices(undefined)).toBeUndefined();
	});

	it("returns nothing when no price participated (unknown model) or prices are undefined", () => {
		expect(buildPriceSnapshot(undefined, undefined, 1)).toBeUndefined();
		expect(buildPriceSnapshot({ input_cost_per_token: { per_token: 0, source: "unset" } }, undefined, 1)).toBeUndefined();
	});
});
