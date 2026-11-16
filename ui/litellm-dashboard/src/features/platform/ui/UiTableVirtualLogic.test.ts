import { describe, expect, it } from "vitest";
import { computeUiTableVirtualWindow } from "./UiTableVirtualLogic";

const base = { total: 1000, rowHeight: 33, overscan: 8, bodyTop: 0, viewportHeight: 900 };

describe("computeUiTableVirtualWindow", () => {
	it("renders the first viewport plus overscan when the table starts at the top", () => {
		expect(computeUiTableVirtualWindow(base)).toEqual({ start: 0, end: 36, top: 0, bottom: 31812 });
	});

	it("moves the window as the table scrolls above the viewport", () => {
		expect(computeUiTableVirtualWindow({ ...base, bodyTop: -330 })).toEqual({ start: 2, end: 46, top: 66, bottom: 31482 });
	});

	it("keeps a small overscan window when the table is below the viewport", () => {
		expect(computeUiTableVirtualWindow({ ...base, bodyTop: 1200 })).toEqual({ start: 0, end: 8, top: 0, bottom: 32736 });
	});

	it("clamps at the end when the table has scrolled above the viewport", () => {
		expect(computeUiTableVirtualWindow({ ...base, bodyTop: -40_000 })).toEqual({ start: 992, end: 1000, top: 32736, bottom: 0 });
	});

	it("handles empty and invalid input without producing negative ranges", () => {
		expect(computeUiTableVirtualWindow({ ...base, total: 0 })).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
		expect(computeUiTableVirtualWindow({ ...base, total: 1, rowHeight: 0, overscan: 0, bodyTop: -100 })).toEqual({
			start: 1,
			end: 1,
			top: 1,
			bottom: 0,
		});
	});
});
