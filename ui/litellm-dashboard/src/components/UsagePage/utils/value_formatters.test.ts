import { describe, expect, it } from "vitest";
import { valueFormatterSpend, valueFormatterTokens } from "./value_formatters";

describe("valueFormatterTokens", () => {
	it("formats token values as complete en-US integers without abbreviations", () => {
		expect(valueFormatterTokens(0)).toBe("0");
		expect(valueFormatterTokens(999)).toBe("999");
		expect(valueFormatterTokens(1_000)).toBe("1,000");
		expect(valueFormatterTokens(1_299_321)).toBe("1,299,321");
		expect(valueFormatterTokens(-1_000)).toBe("-1,000");
	});

	it("preserves the shared formatter placeholder for non-finite token values", () => {
		expect(valueFormatterTokens(Number.NaN)).toBe("-");
		expect(valueFormatterTokens(Number.POSITIVE_INFINITY)).toBe("-");
	});
});

describe("valueFormatterSpend", () => {
	it("should return '$0' when the value is exactly zero", () => {
		expect(valueFormatterSpend(0)).toBe("$0");
	});

	it("should format numbers >= 1,000,000 as dollar millions", () => {
		expect(valueFormatterSpend(1_000_000)).toBe("$1M");
		expect(valueFormatterSpend(2_500_000)).toBe("$2.5M");
		expect(valueFormatterSpend(10_000_000)).toBe("$10M");
	});

	it("should format numbers >= 1,000 as dollar thousands", () => {
		expect(valueFormatterSpend(1_000)).toBe("$1k");
		expect(valueFormatterSpend(5_500)).toBe("$5.5k");
		expect(valueFormatterSpend(999_999)).toBe("$999.999k");
	});

	it("should format numbers below 1,000 as plain dollar amounts", () => {
		expect(valueFormatterSpend(1)).toBe("$1");
		expect(valueFormatterSpend(99.99)).toBe("$99.99");
		expect(valueFormatterSpend(999)).toBe("$999");
	});

	it("should treat exactly 1,000,000 as the millions boundary", () => {
		expect(valueFormatterSpend(1_000_000)).toBe("$1M");
	});

	it("should treat exactly 1,000 as the thousands boundary", () => {
		expect(valueFormatterSpend(1_000)).toBe("$1k");
	});
});
