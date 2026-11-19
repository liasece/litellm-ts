import { describe, expect, it } from "vitest";
import {
	clearUpstreamQuotaCache,
	parseUpstreamQuotaCache,
	readUpstreamQuotaCache,
	UPSTREAM_QUOTA_CACHE_MAX_AGE_MS,
	writeUpstreamQuotaCache,
	type UpstreamQuotaStorage,
} from "./UpstreamQuotaCacheData";
import type { AccountQuota, BuiltInQuotaAccount, UpstreamAccount } from "../api/UpstreamQuotaApi";

const NOW = Date.parse("2026-11-19T03:30:00Z");
const account: UpstreamAccount = { auth_index: "7", key: "claude-7.json", provider: "claude", email: "a@example.com" };
const quota: AccountQuota = {
	provider: "claude",
	plan: "Max 20x",
	subscription_expires_at: "2026-12-06T03:43:59Z",
	windows: [{ id: "5h", label: "5 小时", remaining_percent: 72, resets_at: "2026-11-20T00:00:00Z" }],
	balances: [{ label: "剩余计划额度", used: 0.01, limit: 35, unit: "USD" }],
	fetched_at: "2026-11-19T03:00:00Z",
};
const provider: BuiltInQuotaAccount = {
	id: "deepseek",
	provider: "deepseek",
	label: "deepseek",
	models: ["deepseek/deepseek-v4-flash"],
	account_kind: "pay_as_you_go",
	plan: null,
	subscription_expires_at: null,
	windows: [],
	balances: [{ label: "余额", remaining: 694.45, unit: "CNY" }],
	fetched_at: "2026-11-19T03:00:00Z",
};

function memoryStorage(seed?: string) {
	const entries = new Map<string, string>();
	if (seed !== undefined) entries.set("upstreamAccountQuotaCache", seed);
	return {
		entries,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
		removeItem: (key: string) => void entries.delete(key),
	};
}

describe("upstream quota cache", () => {
	it("round-trips accounts, providers and quota snapshots", () => {
		const storage = memoryStorage();
		writeUpstreamQuotaCache(storage, { accounts: [account], providers: [provider], quotas: { 7: quota } }, NOW);
		const snapshot = readUpstreamQuotaCache(storage, NOW + 60_000);
		expect(snapshot?.savedAt).toBe(NOW);
		expect(snapshot?.accounts).toEqual([account]);
		expect(snapshot?.providers).toEqual([provider]);
		expect(snapshot?.quotas["7"].windows).toEqual(quota.windows);
	});

	it("drops snapshots that are corrupt, versioned differently or missing fields", () => {
		expect(parseUpstreamQuotaCache("{not json", NOW)).toBeNull();
		expect(
			parseUpstreamQuotaCache(JSON.stringify({ version: 0, savedAt: NOW, accounts: [], providers: [], quotas: {} }), NOW),
		).toBeNull();
		expect(
			parseUpstreamQuotaCache(
				JSON.stringify({ version: 1, savedAt: NOW, accounts: [{ auth_index: "1" }], providers: [], quotas: {} }),
				NOW,
			),
		).toBeNull();
		expect(
			parseUpstreamQuotaCache(
				JSON.stringify({ version: 1, savedAt: NOW, accounts: [], providers: [], quotas: { 1: { provider: "claude" } } }),
				NOW,
			),
		).toBeNull();
	});

	it("ignores snapshots older than the retention window, including future timestamps", () => {
		const storage = memoryStorage();
		writeUpstreamQuotaCache(storage, { accounts: [account], providers: [], quotas: {} }, NOW);
		expect(readUpstreamQuotaCache(storage, NOW + UPSTREAM_QUOTA_CACHE_MAX_AGE_MS - 1)).not.toBeNull();
		expect(readUpstreamQuotaCache(storage, NOW + UPSTREAM_QUOTA_CACHE_MAX_AGE_MS + 1)).toBeNull();
		expect(readUpstreamQuotaCache(storage, NOW - UPSTREAM_QUOTA_CACHE_MAX_AGE_MS - 1)).toBeNull();
	});

	it("treats unavailable or failing storage as no cache", () => {
		expect(readUpstreamQuotaCache(null)).toBeNull();
		const failing: UpstreamQuotaStorage = {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {
				throw new Error("SecurityError");
			},
		};
		expect(readUpstreamQuotaCache(failing)).toBeNull();
		expect(() => writeUpstreamQuotaCache(failing, { accounts: [], providers: [], quotas: {} })).not.toThrow();
		expect(() => clearUpstreamQuotaCache(failing)).not.toThrow();
	});

	it("clears the stored snapshot", () => {
		const storage = memoryStorage();
		writeUpstreamQuotaCache(storage, { accounts: [account], providers: [], quotas: {} }, NOW);
		clearUpstreamQuotaCache(storage);
		expect(readUpstreamQuotaCache(storage, NOW)).toBeNull();
	});
});
