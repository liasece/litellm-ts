import { describe, expect, it, vi } from "vitest";
import { createResourceStore } from "./ResourceStore";
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
describe("Access resource request lifecycle", () => {
	it("never replaces newer filtered rows when an older response arrives late", async () => {
		const first = deferred<{ id: string }[]>(),
			second = deferred<{ id: string }[]>();
		const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const store = createResourceStore(load);
		const older = store.refresh(),
			newer = store.refresh();
		expect(load.mock.calls[0][0].aborted).toBe(true);
		second.resolve([{ id: "new" }]);
		await newer;
		first.resolve([{ id: "stale" }]);
		await older;
		expect(store.rows.value).toEqual([{ id: "new" }]);
	});
	it("does not reopen details after the user has closed the drawer while its request was pending", async () => {
		const detail = deferred<{ id: string }>();
		const store = createResourceStore(
			async () => [],
			() => detail.promise,
		);
		const pending = store.open("a");
		store.close();
		detail.resolve({ id: "a" });
		await pending;
		expect(store.selected.value).toBeNull();
		expect(store.state.detailLoading).toBe(false);
	});
	it("applies resource-specific search then sorts the entire list before a page is selected", async () => {
		const store = createResourceStore(
			async () => [
				{ id: "1", name: "Zulu", created_at: "2026" },
				{ id: "2", name: "Alpha", created_at: "2026" },
				{ id: "3", name: "Beta", created_at: "2026" },
			],
			undefined,
			(row, query) => row.name.toLowerCase().includes(query),
		);
		await store.refresh();
		store.state.query = "2026";
		expect(store.filtered.value).toEqual([]);
		store.state.query = "";
		store.sort("name", "asc");
		expect(store.ordered.value.slice(0, 2).map((row) => row.id)).toEqual(["2", "3"]);
	});
	it("retains a failed mutation for retry without refreshing or reporting success", async () => {
		const load = vi.fn(async () => [{ id: "keep" }]),
			operation = vi.fn().mockRejectedValue(new Error("Forbidden"));
		const store = createResourceStore(load);
		await store.refresh();
		await expect(store.run(operation, "Deleted")).resolves.toBe(false);
		expect(store.state.error).toBe("Forbidden");
		expect(store.state.message).toBe("");
		expect(load).toHaveBeenCalledTimes(1);
		expect(store.rows.value).toEqual([{ id: "keep" }]);
	});
});
