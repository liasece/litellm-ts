import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applicationUsageApi } from "./ApplicationUsageApi";
import { createApplicationUsageIndicatorStore } from "../stores/ApplicationUsageIndicatorStore";
const usage = {
		total_users: 10,
		total_users_used: 8,
		total_users_remaining: 2,
		total_teams: null,
		total_teams_used: 0,
		total_teams_remaining: null,
	},
	fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
	fetch.mockReset();
	vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("Usage and optional license requests", () => {
	it("uses the original GET endpoints with Cookie credentials and no authorization/content type header", async () => {
		fetch.mockResolvedValueOnce(new Response(JSON.stringify(usage))).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					has_license: true,
					license_type: "enterprise",
					expiration_date: "2026-11-07",
					allowed_features: [],
					limits: { max_users: 10, max_teams: null },
				}),
			),
		);
		await applicationUsageApi.remaining();
		await applicationUsageApi.license();
		expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual(["/user/available_users", "/health/license"]);
		for (const [, init] of fetch.mock.calls) {
			expect(init).toMatchObject({ method: "GET", credentials: "include" });
			const headers = new Headers(init?.headers);
			expect(headers.has("Authorization")).toBe(false);
			expect(headers.has("Content-Type")).toBe(false);
		}
	});
	it("treats 404 as unavailable for either endpoint while preserving other network failures", async () => {
		fetch
			.mockResolvedValueOnce(new Response("", { status: 404 }))
			.mockResolvedValueOnce(new Response("", { status: 404 }))
			.mockResolvedValueOnce(new Response("", { status: 500 }));
		await expect(applicationUsageApi.remaining()).resolves.toBeNull();
		await expect(applicationUsageApi.license()).resolves.toBeNull();
		await expect(applicationUsageApi.remaining()).rejects.toThrow("Network response was not ok");
	});
	it("loads usage despite an unavailable license and defaults to a minimized card", async () => {
		const remaining = vi.fn<typeof applicationUsageApi.remaining>().mockResolvedValue(usage),
			license = vi.fn<typeof applicationUsageApi.license>().mockRejectedValue(new Error("optional")),
			store = createApplicationUsageIndicatorStore(() => true, { remaining, license });
		await store.load();
		expect(store.data.value).toEqual(usage);
		expect(store.license.value).toBeNull();
		expect(store.state).toMatchObject({ loading: false, error: "", minimized: true });
		expect(store.metrics.value.warning).toBe(true);
		store.dispose();
	});
	it("reports a usage failure and does not fetch when unauthenticated", async () => {
		const remaining = vi.fn<typeof applicationUsageApi.remaining>().mockRejectedValue(new Error("usage failed")),
			license = vi.fn<typeof applicationUsageApi.license>().mockResolvedValue(null),
			store = createApplicationUsageIndicatorStore(() => true, { remaining, license });
		await store.load();
		expect(store.state.error).toBe("Failed to load usage data");
		expect(store.state.loading).toBe(false);
		store.dispose();
		await createApplicationUsageIndicatorStore(() => false, { remaining, license }).load();
		expect(remaining).toHaveBeenCalledTimes(1);
	});
});
