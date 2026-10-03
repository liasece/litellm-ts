import { describe, expect, it } from "vitest";
import {
	DEFAULT_PRICE_SETTINGS,
	formatPrice,
	parseExchangeRates,
	targetCurrency,
	validateSource,
} from "./priceDisplay";

const now = Date.parse("2026-09-28T12:00:00Z");
const settings = { ...DEFAULT_PRICE_SETTINGS, currency: "CNY", modelCurrencies: { one: "EUR" } };
const exchange = parseExchangeRates(
	[
		{ base: "USD", quote: "CNY", rate: 7, date: "2026-09-25" },
		{ base: "USD", quote: "EUR", rate: 0.9, date: "2026-09-25" },
	],
	settings.source,
	now,
);

describe("价格显示换算", () => {
	it("默认 USD，模型覆盖优先，其他模型跟随系统", () => {
		expect(formatPrice(2, DEFAULT_PRICE_SETTINGS, null, 2, undefined, now)).toBe("$2.00");
		expect(formatPrice(2, settings, exchange, 2, undefined, now)).toBe("CNY 14.00");
		expect(formatPrice(2, settings, exchange, 2, { model_info: { id: "one" } }, now)).toBe("EUR 1.80");
		expect(targetCurrency(settings, "other")).toBe("CNY");
		expect(formatPrice(200, settings, exchange, "compact", undefined, now)).toBe("CNY 1.4k");
	});
	it("转换原值且不修改 API 对象；零、缺省、小额、负数有明确显示", () => {
		const response = Object.freeze({ spend: 0.123456 });
		expect(formatPrice(response.spend, settings, exchange, 4, undefined, now)).toBe("CNY 0.8642");
		expect(response.spend).toBe(0.123456);
		expect(formatPrice(0, settings, exchange, 2, undefined, now)).toBe("CNY 0.00");
		expect(formatPrice(null, settings, exchange, 2, undefined, now)).toBe("-");
		expect(formatPrice(0.00000001, settings, exchange, 4, undefined, now)).toBe("< CNY 0.0001");
		expect(formatPrice(-2, settings, exchange, 2, undefined, now)).toBe("CNY -14.00");
	});
	it("缺失、过期或来自旧数据源的汇率不能冒充目标价格", () => {
		expect(formatPrice(2, settings, null, 2, undefined, now)).toContain("汇率不可用");
		expect(formatPrice(2, settings, exchange, 2, undefined, now + 11 * 86400000)).toContain("汇率不可用");
		expect(formatPrice(2, { ...settings, source: "https://example.org" }, exchange, 2, undefined, now)).toContain(
			"汇率不可用",
		);
	});
	it("接受可替换源，拒绝错误基准和异常汇率", () => {
		expect(
			parseExchangeRates({ base: "USD", date: "2026-09-25", rates: { CNY: 7 } }, settings.source, now).rates.CNY,
		).toBe(7);
		for (const rate of [0, -1, Infinity, NaN, "7"]) {
			expect(() =>
				parseExchangeRates({ base: "USD", date: "2026-09-25", rates: { CNY: rate } }, settings.source, now),
			).toThrow();
		}
		expect(() =>
			parseExchangeRates({ base: "EUR", date: "2026-09-25", rates: { CNY: 7 } }, settings.source, now),
		).toThrow();
		expect(() => parseExchangeRates([], settings.source, now)).toThrow();
		expect(() =>
			parseExchangeRates({ base: "USD", date: "2020-01-01", rates: { CNY: 7 } }, settings.source, now),
		).toThrow();
		expect(() => validateSource("http://example.org")).toThrow();
		expect(() => validateSource("https://user:secret@example.org")).toThrow();
	});
});
