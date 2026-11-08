import { describe, expect, it } from "vitest";
import { createPriceDisplayStore } from "./PriceDisplayStore";
import { DEFAULT_RATE_SOURCE, type ExchangeRates } from "../logic/PriceDisplayLogic";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function rates(source: string, cny: number): ExchangeRates {
	return { source, date: new Date().toISOString().slice(0, 10), fetchedAt: Date.now(), rates: { USD: 1, CNY: cny } };
}

describe("Price display preferences", () => {
	it("restores saved per-model currencies without changing source amounts", async () => {
		const values = new Map([
			[
				"litellm-price-display-v1",
				JSON.stringify({ currency: "USD", modelCurrencies: { "model-1": "CNY" }, source: DEFAULT_RATE_SOURCE }),
			],
		]);
		const store = createPriceDisplayStore({
			storage: {
				getItem: (key) => values.get(key) ?? null,
				setItem: (key, value) => {
					values.set(key, value);
				},
			},
			fetchRates: async (source) => rates(source, 7),
		});
		await store.initialize();
		expect(store.format(1, 4)).toBe("$1.0000");
		expect(store.format(1, 4, "model-1")).toBe("CNY 7.0000");
		expect(store.format(0.00000001, 4)).toBe("< $0.0001");
		store.dispose();
	});

	it("does not accept a late response from a source the user has replaced", async () => {
		const first = deferred<ExchangeRates>();
		const second = deferred<ExchangeRates>();
		const source = "https://rates.example/latest";
		const store = createPriceDisplayStore({
			fetchRates: (requested) => (requested === DEFAULT_RATE_SOURCE ? first.promise : second.promise),
		});
		const initial = store.initialize();
		store.save({ currency: "CNY", modelCurrencies: {}, source });
		second.resolve(rates(source, 8));
		await store.refresh();
		first.resolve(rates(DEFAULT_RATE_SOURCE, 7));
		await initial;
		expect(store.state.exchange?.source).toBe(source);
		expect(store.format(1)).toBe("CNY 8.0000");
		store.dispose();
	});

	it("shows unavailable exchange status instead of inventing an amount after a failed refresh", async () => {
		const store = createPriceDisplayStore({
			storage: {
				getItem: () => JSON.stringify({ currency: "CNY", modelCurrencies: {}, source: DEFAULT_RATE_SOURCE }),
				setItem: () => undefined,
			},
			fetchRates: async () => {
				throw new Error("offline");
			},
		});
		await store.initialize();
		expect(store.format(1)).toBe("— (CNY 汇率不可用)");
		expect(store.state.error).toContain("不会显示错误金额");
		store.dispose();
	});
});
