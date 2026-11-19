import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpstreamQuotaStore } from "./UpstreamQuotaStore";
import { readUpstreamQuotaCache, writeUpstreamQuotaCache, type UpstreamQuotaStorage } from "../data/UpstreamQuotaCacheData";
import type { AccountQuota, UpstreamAccount } from "../api/UpstreamQuotaApi";

const account: UpstreamAccount = { auth_index: "a", key: "fixture", provider: "codex", email: "a@example.com" };
const quota: AccountQuota = {
	provider: "codex",
	plan: null,
	subscription_expires_at: null,
	windows: [],
	balances: [],
	fetched_at: "2026-11-07T00:00:00Z",
};

function memoryStorage(): UpstreamQuotaStorage {
	const entries = new Map<string, string>();
	return {
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => void entries.set(key, value),
		removeItem: (key) => void entries.delete(key),
	};
}

afterEach(() => vi.useRealTimers());

/** 假定时器环境：可见性可控，定时器交给 vitest 的 fake timers。 */
function fakeEnvironment(initialHidden = false) {
	let hidden = initialHidden;
	return {
		hidden: () => hidden,
		setHidden: (value: boolean) => {
			hidden = value;
		},
		now: () => Date.now(),
		setTimer: (callback: () => void, delay: number) => setTimeout(callback, delay),
		clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
	};
}

describe("optional upstream quota", () => {
	it("refreshes quotas without reloading the account list and forces only the built-in quota cache", async () => {
		const api = {
			accounts: vi.fn().mockResolvedValue([{ auth_index: "a", key: "fixture", provider: "codex", email: null }]),
			quota: vi.fn().mockResolvedValue(quota),
			builtIn: vi.fn().mockResolvedValue([]),
		};
		const store = createUpstreamQuotaStore(api, null);
		await store.load();
		await store.load(true);
		expect(api.accounts).toHaveBeenCalledTimes(1);
		expect(api.quota).toHaveBeenCalledTimes(2);
		expect(api.builtIn.mock.calls.map((call) => call[0])).toEqual([false, true]);
		expect(store.state.refreshing).toBe(false);
		store.dispose();
	});

	it("isolates optional quota failures from the rest of usage", async () => {
		const store = createUpstreamQuotaStore(
			{
				accounts: vi.fn().mockRejectedValue(new Error("Forbidden")),
				quota: vi.fn(),
				builtIn: vi.fn().mockRejectedValue(new Error("Unavailable")),
			},
			null,
		);
		await store.load();
		expect(store.state.accounts).toEqual([]);
		expect(store.state.providers).toEqual([]);
		expect(store.state.accountsError).toBe("Forbidden");
		expect(store.state.builtInError).toBe("Unavailable");
		expect(store.state.refreshing).toBe(false);
		store.dispose();
	});

	it("paints the cached snapshot first and keeps it, with the real error, when the refresh fails", async () => {
		const storage = memoryStorage();
		writeUpstreamQuotaCache(storage, { accounts: [account], providers: [], quotas: { a: quota } });
		const api = {
			accounts: vi.fn().mockRejectedValue(new Error("Forbidden")),
			quota: vi.fn(),
			builtIn: vi.fn().mockRejectedValue(new Error("Unavailable")),
		};
		const store = createUpstreamQuotaStore(api, storage);
		expect(store.state.accounts).toEqual([account]);
		expect(store.state.quotas.a).toMatchObject({ status: "success", data: quota });

		await store.load();
		expect(store.state.accounts).toEqual([account]);
		expect(store.state.quotas.a).toMatchObject({ status: "success", data: quota });
		expect(store.state.accountsError).toBe("Forbidden");
		expect(store.state.builtInError).toBe("Unavailable");
		store.dispose();
	});

	it("replaces cached values with fresh data and rewrites the stored snapshot", async () => {
		const storage = memoryStorage();
		writeUpstreamQuotaCache(storage, { accounts: [account], providers: [], quotas: { a: quota } });
		const fresh = { ...quota, plan: "Pro", fetched_at: "2026-11-19T03:30:00Z" };
		const store = createUpstreamQuotaStore(
			{
				accounts: vi.fn().mockResolvedValue([account]),
				quota: vi.fn().mockResolvedValue(fresh),
				builtIn: vi.fn().mockResolvedValue([]),
			},
			storage,
		);
		await store.load();
		expect(store.state.quotas.a).toMatchObject({ status: "success", data: fresh });
		expect(readUpstreamQuotaCache(storage)?.quotas.a.fetched_at).toBe("2026-11-19T03:30:00Z");
		store.dispose();
	});

	it("polls on its own interval while the page stays visible", async () => {
		vi.useFakeTimers();
		const api = {
			accounts: vi.fn().mockResolvedValue([account]),
			quota: vi.fn().mockResolvedValue(quota),
			builtIn: vi.fn().mockResolvedValue([]),
		};
		const store = createUpstreamQuotaStore(api, null, { interval: 60_000, environment: fakeEnvironment() });
		store.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(api.builtIn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(api.builtIn).toHaveBeenCalledTimes(2);
		expect(api.accounts).toHaveBeenCalledTimes(2);
		expect(api.quota).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(api.builtIn).toHaveBeenCalledTimes(3);
		expect(api.accounts).toHaveBeenCalledTimes(3);
		store.dispose();
	});

	it("skips polling while hidden and refreshes as soon as the page is visible again", async () => {
		vi.useFakeTimers();
		const api = {
			accounts: vi.fn().mockResolvedValue([account]),
			quota: vi.fn().mockResolvedValue(quota),
			builtIn: vi.fn().mockResolvedValue([]),
		};
		const environment = fakeEnvironment(true);
		const store = createUpstreamQuotaStore(api, null, { interval: 60_000, environment });
		store.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(api.builtIn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(180_000);
		expect(api.builtIn).toHaveBeenCalledTimes(1);
		environment.setHidden(false);
		store.wake();
		await vi.advanceTimersByTimeAsync(0);
		expect(api.builtIn).toHaveBeenCalledTimes(2);
		store.dispose();
	});

	it("keeps the previous value on a per-account error and leaves the snapshot untouched when nothing refreshes", async () => {
		const storage = memoryStorage();
		const api = {
			accounts: vi.fn().mockResolvedValue([account]),
			quota: vi.fn().mockResolvedValue(quota),
			builtIn: vi.fn().mockResolvedValue([]),
		};
		const store = createUpstreamQuotaStore(api, storage);
		await store.load();
		const savedAfterFirstLoad = readUpstreamQuotaCache(storage)?.savedAt;

		api.quota.mockRejectedValue(new Error("upstream 502"));
		await store.load(true);
		expect(store.state.quotas.a).toMatchObject({ status: "error", error: "upstream 502", data: quota });
		expect(readUpstreamQuotaCache(storage)?.savedAt).toBe(savedAfterFirstLoad);
		store.dispose();
	});
});
