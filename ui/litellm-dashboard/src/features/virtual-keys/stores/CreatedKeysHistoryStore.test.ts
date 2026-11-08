import { beforeEach, describe, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
describe("legacy customer key choices", () => {
	it("offers newly created keys only to their current signed-in user", async () => {
		const { rememberCreatedKey, createdKeyChoices } = await import("./CreatedKeysHistoryStore");
		expect(createdKeyChoices("user-a")).toEqual([]);
		rememberCreatedKey("user-a", { key_alias: "Research", token: "hash-1", key: "synthetic-secret", api_key: "synthetic-secret" });
		expect(createdKeyChoices("user-a")).toEqual([{ key_alias: "Research", token: "hash-1" }]);
		expect(createdKeyChoices("user-b")).toEqual([]);
	});
	it("keeps unnamed keys out of the old customer alias selector", async () => {
		const { rememberCreatedKey, createdKeyChoices } = await import("./CreatedKeysHistoryStore");
		rememberCreatedKey("user-a", { token: "hash-1" });
		rememberCreatedKey("user-a", { key_alias: "" });
		expect(createdKeyChoices("user-a")).toEqual([]);
	});
});
