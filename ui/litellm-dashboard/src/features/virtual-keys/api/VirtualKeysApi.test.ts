import { afterEach, describe, expect, it, vi } from "vitest";
import { createKey, deleteKey, keyInfo, listKeys, regenerateKey } from "./VirtualKeysApi";
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
	it("uses the real generation, regeneration and delete endpoints", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
		vi.stubGlobal("fetch", fetch);
		await createKey({ key_alias: "service" });
		await regenerateKey("hash", { grace_period: "24h" });
		await deleteKey("hash");
		expect(fetch.mock.calls.map((call) => call[0])).toEqual(["/key/generate", "/key/regenerate", "/key/delete"]);
		expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
			{ key_alias: "service" },
			{ grace_period: "24h", token: "hash" },
			{ keys: ["hash"] },
		]);
	});
});
