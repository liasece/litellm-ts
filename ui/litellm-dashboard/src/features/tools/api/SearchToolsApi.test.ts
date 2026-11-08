import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { searchToolsApi } from "./SearchToolsApi";
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
	fetch.mockReset();
	vi.stubGlobal("fetch", fetch);
	vi.stubGlobal("document", { cookie: "litellm_csrf_token=synthetic-csrf" });
});
afterEach(() => vi.unstubAllGlobals());
describe("Search provider responses", () => {
	it("keeps the legacy missing-provider empty state while retaining valid provider metadata", async () => {
		fetch.mockResolvedValueOnce(new Response("{}"));
		await expect(searchToolsApi.providers()).resolves.toEqual([]);
		const providers = [{ provider_name: "synthetic", ui_friendly_name: "Synthetic Search" }];
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ providers })));
		await expect(searchToolsApi.providers()).resolves.toEqual(providers);
		expect(fetch.mock.calls[0][0]).toBe("/search_tools/ui/available_providers");
	});
	it("still rejects malformed provider records instead of passing unusable options to the create form", async () => {
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ providers: [{ provider_name: 42 }] })));
		await expect(searchToolsApi.providers()).rejects.toThrow();
	});
});
