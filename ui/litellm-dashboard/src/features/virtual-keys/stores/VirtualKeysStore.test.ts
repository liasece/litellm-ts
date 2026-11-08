import { afterEach, describe, expect, it, vi } from "vitest";
import { createVirtualKeysStore } from "./VirtualKeysStore";
import { virtualKeysApi } from "../api/VirtualKeysApi";
import type { KeyListResult, VirtualKey } from "../support/VirtualKeyModels";
afterEach(() => vi.restoreAllMocks());
const row = (token: string): VirtualKey => ({ token, key_alias: token, models: [], metadata: {} });
describe("Virtual Keys list updates", () => {
	it("ignores a stale filter response and passes the current page and sorting to the server", async () => {
		let resolveOld: (result: KeyListResult) => void = () => undefined;
		const listKeys = vi
			.fn()
			.mockImplementationOnce(() => new Promise<KeyListResult>((resolve) => (resolveOld = resolve)))
			.mockResolvedValue({ keys: [row("new")], total_count: 101 });
		const store = createVirtualKeysStore({ ...virtualKeysApi, listKeys });
		const old = store.refresh();
		await store.filter({ team: "team-new", organization: "", alias: "", user: "", hash: "" });
		resolveOld({ keys: [row("stale")], total_count: 1 });
		await old;
		expect(store.state.rows[0].token).toBe("new");
		await store.page(2);
		expect(listKeys.mock.lastCall?.[0]).toMatchObject({
			page: 2,
			size: 50,
			sortBy: "created_at",
			sortOrder: "desc",
			filters: { team: "team-new" },
		});
		await store.sort("spend");
		expect(listKeys.mock.lastCall?.[0]).toMatchObject({ sortBy: "spend", sortOrder: "desc" });
		store.dispose();
	});
	it("sends the original blocked toggle contract and refreshes after success", async () => {
		const listKeys = vi.fn().mockResolvedValue({ keys: [row("key-1")], total_count: 1 }),
			updateKey = vi.fn().mockResolvedValue({});
		const store = createVirtualKeysStore({ ...virtualKeysApi, listKeys, updateKey });
		await store.toggleEnabled(row("key-1"), false);
		expect(updateKey).toHaveBeenCalledWith({ token: "key-1", blocked: true });
		expect(listKeys).toHaveBeenCalledTimes(1);
		expect(store.state.pendingToken).toBe("");
		store.dispose();
	});
	it("does not replace the list after disposal", async () => {
		let resolve: (result: KeyListResult) => void = () => undefined;
		const listKeys = vi.fn().mockImplementation(() => new Promise<KeyListResult>((done) => (resolve = done)));
		const store = createVirtualKeysStore({ ...virtualKeysApi, listKeys }),
			pending = store.refresh();
		store.dispose();
		resolve({ keys: [row("late")], total_count: 1 });
		await pending;
		expect(store.state.rows).toEqual([]);
	});
});
