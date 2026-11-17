import { UsageActivityCache } from "./UsageActivityCache";

describe("UsageActivityCache", () => {
	it("returns a fresh value without reloading", async () => {
		const cache = new UsageActivityCache<string>({ ttlMs: 1_000, staleMs: 1_000, now: () => 0 });
		const load = jest.fn().mockResolvedValue("one");
		await expect(cache.get("key", load)).resolves.toBe("one");
		await expect(cache.get("key", load)).resolves.toBe("one");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("serves stale data and refreshes once in the background", async () => {
		let now = 0;
		let resolveRefresh!: (value: string) => void;
		const cache = new UsageActivityCache<string>({ ttlMs: 10, staleMs: 1_000, now: () => now });
		await cache.get("key", async () => "old");
		now = 11;
		const refresh = jest.fn().mockImplementation(() => new Promise<string>((resolve) => (resolveRefresh = resolve)));
		await expect(cache.get("key", refresh)).resolves.toBe("old");
		await expect(cache.get("key", refresh)).resolves.toBe("old");
		expect(refresh).toHaveBeenCalledTimes(1);
		resolveRefresh("new");
		await Promise.resolve();
		await expect(cache.get("key", async () => "unused")).resolves.toBe("new");
	});

	it("deduplicates concurrent cold loads", async () => {
		let resolve!: (value: string) => void;
		const cache = new UsageActivityCache<string>({ now: () => 0 });
		const load = jest.fn().mockImplementation(() => new Promise<string>((done) => (resolve = done)));
		const first = cache.get("key", load);
		const second = cache.get("key", load);
		resolve("value");
		await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("does not cache a failed load", async () => {
		const cache = new UsageActivityCache<string>();
		await expect(cache.get("key", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
		await expect(cache.get("key", async () => "recovered")).resolves.toBe("recovered");
	});
});
