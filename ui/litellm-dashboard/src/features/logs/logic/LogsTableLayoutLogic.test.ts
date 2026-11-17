import { describe, expect, it } from "vitest";
import { logsColumns, type LogsColumn } from "../support/LogsColumnModels";
import { computeLogsColumnWidths } from "./LogsTableLayoutLogic";

function widthSum(layout: ReturnType<typeof computeLogsColumnWidths>): number {
	return Object.values(layout.widths).reduce((sum, width) => sum + width, 0);
}

function column(columns: readonly LogsColumn[], id: string): LogsColumn {
	const found = columns.find((item) => item.id === id);
	if (!found) throw new Error("missing column " + id);
	return found;
}

describe("computeLogsColumnWidths", () => {
	it("Time / Status / Session ID / Request ID 固定，剩余宽度只分给弹性列", () => {
		const columns = logsColumns();
		const narrow = computeLogsColumnWidths(columns, 1600);
		const wide = computeLogsColumnWidths(columns, 2560);
		const fixed = ["startTime", "status", "session_id", "request_id"];

		for (const id of fixed) expect(wide.widths[id]).toBe(narrow.widths[id]);
		expect(wide.widths["model"]).toBeGreaterThan(narrow.widths["model"] as number);
		expect(wide.widths["total_tokens"]).toBeGreaterThan(narrow.widths["total_tokens"] as number);
		expect(wide.widths["tps"]).toBeGreaterThan(narrow.widths["tps"] as number);
		expect(narrow.totalWidth).toBe(1600);
		expect(widthSum(narrow)).toBe(1600);
		expect(wide.totalWidth).toBe(2560);
		expect(widthSum(wide)).toBe(2560);
	});

	it("容器不足时保底最小宽度，并报告实际需要的总宽", () => {
		const columns = logsColumns();
		const minimum = computeLogsColumnWidths(columns, 0);
		const layout = computeLogsColumnWidths(columns, 1170);

		expect(layout.totalWidth).toBe(minimum.totalWidth);
		expect(widthSum(layout)).toBe(minimum.totalWidth);
		expect(layout.widths["startTime"]).toBe(column(columns, "startTime").fixedWidth);
		expect(layout.widths["tps"]).toBe(column(columns, "tps").minWidth);
	});

	it("可选列加入后仍保持固定列宽度，并把余量分给新增弹性列", () => {
		const columns = logsColumns(["call_type"]);
		const layout = computeLogsColumnWidths(columns, 1700);

		expect(layout.widths["startTime"]).toBe(column(columns, "startTime").fixedWidth);
		expect(layout.totalWidth).toBe(1700);
		expect(widthSum(layout)).toBe(1700);
	});
});
