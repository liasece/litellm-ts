import { afterEach, describe, expect, it, vi } from "vitest";
import { createKey, deleteKey, keyInfo, listKeys, regenerateKey, resetKeySpend } from "./VirtualKeysApi";
afterEach(() => vi.unstubAllGlobals());
describe("Virtual Key HTTP boundary", () => {
	it("preserves server-side list filters, expansion and pagination", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(Response.json({ keys: [{ token: "fixture", models: null, metadata: null }], total_count: 1 }));
		vi.stubGlobal("fetch", fetch);
		const result = await listKeys({
			page: 3,
			size: 50,
			sortBy: "spend",
			sortOrder: "desc",
			filters: { team: "t/a", organization: "org", alias: "Research + API", user: "owner", hash: "hash" },
		});
		const url = new URL(String(fetch.mock.calls[0][0]), "http://fixture.local");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			page: "3",
			size: "50",
			sort_by: "spend",
			sort_order: "desc",
			team_id: "t/a",
			organization_id: "org",
			key_alias: "Research + API",
			user_id: "owner",
			key_hash: "hash",
			expand: "user",
			include_created_by_keys: "true",
		});
		expect(result.keys[0]).toMatchObject({ models: [], metadata: {} });
	});
	it("restores the selected hash when the legacy key-info response omits token", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(Response.json({ info: { key_alias: "Research", metadata: { owner: "fixture" } } }));
		vi.stubGlobal("fetch", fetch);
		const result = await keyInfo("selected-key-hash");
		expect(result).toMatchObject({ token: "selected-key-hash", api_key: "selected-key-hash", key_alias: "Research", models: [] });
	});
	it("uses the actual service-account, regeneration, delete and spend reset endpoints", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
		vi.stubGlobal("fetch", fetch);
		await createKey({ key_alias: "service" }, true);
		await regenerateKey("hash", { grace_period: "24h" });
		await deleteKey("hash");
		await resetKeySpend("hash/with space");
		expect(fetch.mock.calls.map((call) => call[0])).toEqual([
			"/key/service-account/generate",
			"/key/regenerate",
			"/key/delete",
			"/key/hash%2Fwith%20space/reset_spend",
		]);
		expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
			{ key_alias: "service" },
			{ grace_period: "24h", token: "hash" },
			{ keys: ["hash"] },
			{ reset_to: 0 },
		]);
	});

	it("accepts a successful reset acknowledgement without inventing a response-body contract", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json([]))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetch);
		await expect(resetKeySpend("hash")).resolves.toBeUndefined();
		await expect(resetKeySpend("hash")).resolves.toBeUndefined();
	});
});
