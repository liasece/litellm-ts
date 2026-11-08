import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealthReadiness } from "./HealthReadinessApi";
afterEach(() => vi.unstubAllGlobals());
describe("Public readiness request", () => {
	it("keeps the Cookie GET contract and preserves readiness metadata", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ is_detailed_debug: true, litellm_version: "1.0.0", database: "connected" })));
		vi.stubGlobal("fetch", fetch);
		await expect(fetchHealthReadiness()).resolves.toMatchObject({ is_detailed_debug: true, database: "connected" });
		expect(String(fetch.mock.calls[0][0])).toBe("/health/readiness");
		const init = fetch.mock.calls[0][1];
		expect(init?.method ?? "GET").toBe("GET");
		expect(init?.credentials).toBe("include");
		expect(new Headers(init?.headers).has("Authorization")).toBe(false);
		expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
	});
	it("keeps missing/false disabled and rejects invalid flags and non-success responses", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response("{}"))
			.mockResolvedValueOnce(new Response('{"is_detailed_debug":false}'))
			.mockResolvedValueOnce(new Response('{"is_detailed_debug":"false"}'))
			.mockResolvedValueOnce(new Response("unavailable", { status: 503, statusText: "Service Unavailable" }));
		vi.stubGlobal("fetch", fetch);
		expect((await fetchHealthReadiness()).is_detailed_debug).toBeUndefined();
		expect((await fetchHealthReadiness()).is_detailed_debug).toBe(false);
		await expect(fetchHealthReadiness()).rejects.toThrow();
		await expect(fetchHealthReadiness()).rejects.toThrow("Failed to fetch health readiness: Service Unavailable");
	});
});
