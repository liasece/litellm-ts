import { SubscriptionAccountKeys } from "./SubscriptionAccountKeys";
import type { ConfigRepository } from "../repositories/ConfigRepository";

function repository() {
	let value: Record<string, unknown> | undefined;
	return {
		getParam: jest.fn(async () => value),
		upsertParam: jest.fn(async (_name: string, next: Record<string, unknown>) => {
			value = structuredClone(next);
		}),
	};
}

it("can resume and rotate a subscription from its sealed record without exposing the key in account lists", async () => {
	const store = repository();
	const keys = new SubscriptionAccountKeys(store as unknown as ConfigRepository, "fixture-vault-key");
	const first = await keys.save("commandcode", undefined, "Team", "fixture-subscription-one");
	expect(JSON.stringify(await store.getParam())).not.toContain("fixture-subscription-one");
	const reopened = new SubscriptionAccountKeys(store as unknown as ConfigRepository, "fixture-vault-key");
	await reopened.load();
	expect(reopened.list()).toEqual([{ id: first.id, provider: "commandcode", label: "Team" }]);
	const rotated = await reopened.save("commandcode", first.id, "Team", "fixture-subscription-two");
	expect(rotated.id).toBe(first.id);
	expect(reopened.records.map((record) => record.key)).toEqual(["fixture-subscription-two"]);
	expect(JSON.stringify(await store.getParam())).not.toContain("fixture-subscription-two");
	await expect(new SubscriptionAccountKeys(store as unknown as ConfigRepository, "wrong-key").load()).rejects.toThrow();
});
