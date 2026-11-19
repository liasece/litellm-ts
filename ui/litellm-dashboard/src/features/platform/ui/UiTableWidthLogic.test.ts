import { describe, expect, it } from "vitest";
import { computeUiTableColumnWidths, uiTableColumnMinWidth } from "./UiTableWidthLogic";

const columns = [
	{ key: "id", minWidth: 120 },
	{ key: "name", minWidth: 240 },
	{ key: "costs", minWidth: 240 },
	{ key: "actions", minWidth: 80 },
];

function total(widths: Record<string, number>): number {
	return Object.values(widths).reduce((sum, value) => sum + value, 0);
}

describe("ui table adaptive widths", () => {
	it("keeps every column at its lower bound while the container is too narrow", () => {
		// 容器装不下时不能压缩到内容放不下的宽度，剩下的交给表格横向滚动。
		const widths = computeUiTableColumnWidths({ columns, frameWidth: 400 });
		expect(widths).toEqual({ id: 120, name: 240, costs: 240, actions: 80 });
		expect(total(widths)).toBe(680);
	});

	it("keeps the lower bound when the container is exactly the sum", () => {
		expect(computeUiTableColumnWidths({ columns, frameWidth: 680 })).toEqual({ id: 120, name: 240, costs: 240, actions: 80 });
	});

	it("scales every column proportionally to its lower bound and fills the container", () => {
		// 1.5 倍容器：每列都按自己的下限等比放大，比例保持不变。
		const widths = computeUiTableColumnWidths({ columns, frameWidth: 1020 });
		expect(total(widths)).toBe(1020);
		expect(widths.id).toBe(180);
		expect(widths.name).toBe(360);
		expect(widths.costs).toBe(360);
		expect(widths.actions).toBe(120);
	});

	it("puts the rounding remainder on the widest column", () => {
		const widths = computeUiTableColumnWidths({ columns, frameWidth: 900 });
		expect(total(widths)).toBe(900);
		expect(widths.name).toBe(317);
		expect(widths.costs).toBe(318);
		// 取整余下的 3px 补在最宽的列上，其余列保持按比例的整数值。
		expect(widths.id).toBe(159);
		expect(widths.actions).toBe(106);
	});

	it("falls back to the declared width, then to a readable default", () => {
		expect(uiTableColumnMinWidth({ key: "a", width: 150 })).toBe(150);
		expect(uiTableColumnMinWidth({ key: "b", minWidth: 200, width: 150 })).toBe(200);
		expect(uiTableColumnMinWidth({ key: "c" })).toBe(120);
	});
});
