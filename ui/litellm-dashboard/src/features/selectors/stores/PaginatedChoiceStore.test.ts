import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaginatedChoiceStore } from "./PaginatedChoiceStore";
import type { ChoicePage } from "../api/PaginatedChoiceApi";
afterEach(() => vi.useRealTimers());
describe("remote paginated selectors", () => {
	it("deduplicates accumulated options and stops requesting beyond the final page", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ page: 1, pages: 2, options: [{ value: "a", label: "A" }] })
			.mockResolvedValueOnce({
				page: 2,
				pages: 2,
				options: [
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				],
			});
		const store = createPaginatedChoiceStore("model", 50, fetch);
		await store.load();
		await store.load(true);
		await store.load(true);
		expect(store.state.options.map((option) => option.value)).toEqual(["a", "b"]);
		expect(fetch).toHaveBeenCalledTimes(2);
		store.dispose();
	});
	it("discards an older page after a new search and debounces only the new search", async () => {
		vi.useFakeTimers();
		let resolveOld: (page: ChoicePage) => void = () => undefined;
		const fetch = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<ChoicePage>((resolve) => {
						resolveOld = resolve;
					}),
			)
			.mockResolvedValue({ page: 1, pages: 1, options: [{ value: "new", label: "New" }] });
		const store = createPaginatedChoiceStore("key-alias", 50, fetch),
			old = store.load();
		store.search("n");
		store.search("new");
		resolveOld({ page: 1, pages: 1, options: [{ value: "stale", label: "Stale" }] });
		await old;
		expect(store.state.options).toEqual([]);
		await vi.advanceTimersByTimeAsync(300);
		expect(store.state.options.map((option) => option.value)).toEqual(["new"]);
		expect(fetch).toHaveBeenCalledTimes(2);
		store.dispose();
	});
});
