import { describe, it, expect, vi, afterEach } from "vitest";
import { createModelSelectionStore } from "./ModelSelectionStore";
describe("Single model selection behavior", () => {
	afterEach(() => vi.useRealTimers());
	it("holds custom selection until typing settles and supports returning to a catalogue model", () => {
		vi.useFakeTimers();
		const changed = vi.fn(),
			store = createModelSelectionStore("existing", changed);
		store.choose("custom");
		expect(store.selected.value).toBeUndefined();
		expect(changed).not.toHaveBeenCalled();
		store.typeCustom("first");
		vi.advanceTimersByTime(300);
		store.typeCustom("new model");
		vi.advanceTimersByTime(499);
		expect(changed).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(changed).toHaveBeenCalledWith("new model");
		store.choose("catalogue-model");
		expect(store.custom.value).toBe(false);
		expect(changed).toHaveBeenLastCalledWith("catalogue-model");
		store.dispose();
	});
	it("cancels a pending custom edit when the picker is disposed and keeps external selection synchronized", () => {
		vi.useFakeTimers();
		const changed = vi.fn(),
			store = createModelSelectionStore(undefined, changed);
		store.typeCustom("pending");
		store.setValue("external");
		expect(store.selected.value).toBe("external");
		store.dispose();
		vi.runAllTimers();
		expect(changed).not.toHaveBeenCalled();
	});
	it("retains loaded catalogue on an empty refresh and ignores a superseded load result", async () => {
		let finish: ((value: { model_group: string }[]) => void) | undefined;
		const loader = vi
				.fn<() => Promise<{ model_group: string }[]>>()
				.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
				.mockResolvedValueOnce([{ model_group: "current" }])
				.mockResolvedValueOnce([]),
			store = createModelSelectionStore(undefined, () => {}, loader);
		const first = store.load();
		await store.load();
		finish?.([{ model_group: "stale" }]);
		await first;
		expect(store.options.value.some((option) => option.value === "current")).toBe(true);
		expect(store.options.value.some((option) => option.value === "stale")).toBe(false);
		await store.load();
		expect(store.groups.value).toEqual([{ model_group: "current" }]);
		store.dispose();
	});
});
