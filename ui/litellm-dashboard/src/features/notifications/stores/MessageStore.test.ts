import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageStore } from "./MessageStore";
afterEach(() => vi.useRealTimers());
describe("top message lifecycle", () => {
	it("keeps zero-duration loading visible until its returned closer is called", async () => {
		vi.useFakeTimers();
		const store = createMessageStore(),
			hide = store.push("loading", "Checking synthetic credential", 0);
		await vi.advanceTimersByTimeAsync(60000);
		expect(store.entries[0].type).toBe("loading");
		hide();
		hide();
		expect(store.entries).toHaveLength(0);
		await expect(Promise.resolve(hide)).resolves.toBe(true);
	});
	it("destroy cancels timers and settles pending loading handles", async () => {
		vi.useFakeTimers();
		const store = createMessageStore(),
			first = store.push("loading", "Loading", 0),
			second = store.push("error", "Synthetic error", 5);
		store.clear();
		expect(store.entries).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		await expect(Promise.all([Promise.resolve(first), Promise.resolve(second)])).resolves.toEqual([true, true]);
	});
});
