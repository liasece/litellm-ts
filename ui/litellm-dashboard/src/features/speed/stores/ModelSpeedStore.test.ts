import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelSpeedStore } from "./ModelSpeedStore";
import type { ModelSpeedReport, SpeedApi } from "../support/SpeedModels";
function report(model: string): ModelSpeedReport {
	return {
		start_date: "2026-11-01",
		end_date: "2026-11-07",
		bucket: "day",
		timezone: "UTC",
		min_output_tokens: 20,
		min_bucket_requests: 2,
		buckets: ["2026-11-07T00:00:00Z"],
		models: [
			{
				model,
				provider: "minimax",
				calls: 3,
				requests: 3,
				avg_tps: 30,
				p50_tps: 29,
				points: [{ bucket: "2026-11-07T00:00:00Z", avg_tps: 30, p50_tps: 29, requests: 3 }],
			},
		],
		models_without_speed: [],
	};
}
afterEach(() => vi.useRealTimers());
describe("speed request lifecycle", () => {
	it("aborts an old range and ignores its delayed response", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
		let resolveOld: (value: ModelSpeedReport) => void = () => undefined;
		const api = vi
			.fn<SpeedApi>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOld = resolve;
					}),
			)
			.mockResolvedValueOnce(report("fresh"));
		const store = createModelSpeedStore(api),
			first = store.load();
		store.setRange(1);
		expect(api.mock.calls[0][1]?.aborted).toBe(true);
		await Promise.resolve();
		resolveOld(report("stale"));
		await first;
		expect(store.state.data?.models[0].model).toBe("fresh");
		expect(api.mock.calls[1][0].startDate).toBe(api.mock.calls[1][0].endDate);
		store.dispose();
	});
	it("keeps the cached range when a different pending range completes late", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
		let resolveThirty: (value: ModelSpeedReport) => void = () => undefined;
		const api = vi
			.fn<SpeedApi>()
			.mockResolvedValueOnce(report("seven"))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveThirty = resolve;
					}),
			);
		const store = createModelSpeedStore(api);
		await store.load();
		store.setRange(30);
		store.setRange(7);
		expect(api).toHaveBeenCalledTimes(2);
		expect(api.mock.calls[1][1]?.aborted).toBe(true);
		resolveThirty(report("thirty"));
		await Promise.resolve();
		await Promise.resolve();
		expect(store.state.data?.models[0].model).toBe("seven");
		store.dispose();
	});
	it("cancels a retry delay when the page is disposed", async () => {
		vi.useFakeTimers();
		const api = vi.fn<SpeedApi>().mockRejectedValue(new TypeError("Network unavailable")),
			store = createModelSpeedStore(api),
			pending = store.load();
		await Promise.resolve();
		expect(vi.getTimerCount()).toBe(1);
		store.dispose();
		await pending;
		expect(vi.getTimerCount()).toBe(0);
		expect(api).toHaveBeenCalledTimes(1);
	});
});
