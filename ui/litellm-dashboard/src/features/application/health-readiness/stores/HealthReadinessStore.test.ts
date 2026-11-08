import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthReadinessStore } from "./HealthReadinessStore";
import type { fetchHealthReadiness, HealthReadiness } from "../api/HealthReadinessApi";
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe("Readiness freshness and lifecycle", () => {
	it("deduplicates in-flight reads and refreshes only after the original five-minute freshness window", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000000);
		let complete: ((data: HealthReadiness) => void) | undefined;
		const fetcher = vi
				.fn<typeof fetchHealthReadiness>()
				.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)))
				.mockResolvedValue({ is_detailed_debug: false }),
			store = createHealthReadinessStore(fetcher);
		const first = store.load();
		expect(store.load()).toBe(first);
		complete?.({ is_detailed_debug: true });
		await first;
		await vi.advanceTimersByTimeAsync(299999);
		await store.load();
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await store.load();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(store.data.value?.is_detailed_debug).toBe(false);
		store.dispose();
	});
	it("retries three times with the original backoff and keeps a previous warning after a failed refresh", async () => {
		vi.useFakeTimers();
		const fetcher = vi
				.fn<typeof fetchHealthReadiness>()
				.mockResolvedValueOnce({ is_detailed_debug: true })
				.mockRejectedValue(new Error("synthetic unavailable")),
			store = createHealthReadinessStore(fetcher);
		await store.load();
		const refresh = store.load(true);
		await vi.advanceTimersByTimeAsync(7000);
		await refresh;
		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(store.data.value?.is_detailed_debug).toBe(true);
		expect(store.state.error).toBe("synthetic unavailable");
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
	it("refreshes stale data on visibility/online and releases listeners and cached data after unmount", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000000);
		const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }),
			windowTarget = new EventTarget();
		vi.stubGlobal("document", doc);
		vi.stubGlobal("window", windowTarget);
		const fetcher = vi
				.fn<typeof fetchHealthReadiness>()
				.mockResolvedValueOnce({ is_detailed_debug: true })
				.mockResolvedValue({ is_detailed_debug: false }),
			store = createHealthReadinessStore(fetcher),
			release = store.acquire();
		await store.load();
		doc.dispatchEvent(new Event("visibilitychange"));
		await store.load();
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(300000);
		windowTarget.dispatchEvent(new Event("online"));
		await store.load();
		expect(fetcher).toHaveBeenCalledTimes(2);
		release();
		await vi.advanceTimersByTimeAsync(300000);
		expect(store.data.value).toBeNull();
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(fetcher).toHaveBeenCalledTimes(2);
		store.dispose();
	});
	it("cancels a pending retry on disposal and prevents late results from restoring a dismissed resource", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn<typeof fetchHealthReadiness>().mockRejectedValue(new Error("synthetic")),
			store = createHealthReadinessStore(fetcher),
			pending = store.load();
		await Promise.resolve();
		store.dispose();
		await pending;
		await vi.runAllTimersAsync();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(store.data.value).toBeNull();
		expect(store.state.loading).toBe(false);
	});
});
