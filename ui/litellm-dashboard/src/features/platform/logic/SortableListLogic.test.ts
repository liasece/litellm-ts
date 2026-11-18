import { describe, expect, it } from "vitest";
import { moveListItem } from "./SortableListLogic";

describe("moveListItem", () => {
	it("moves an item down and shifts the items in between forward", () => {
		expect(moveListItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
	});

	it("moves an item up and shifts the items in between backward", () => {
		expect(moveListItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
	});

	it("does not mutate the input and keeps the same array for a no-op", () => {
		const values = ["a", "b", "c"];
		const result = moveListItem(values, 1, 1);
		expect(result).toEqual(values);
		expect(result).not.toBe(values);
		expect(values).toEqual(["a", "b", "c"]);
	});

	it("ignores out-of-range positions", () => {
		expect(moveListItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
		expect(moveListItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
		expect(moveListItem([], 0, 0)).toEqual([]);
	});
});
