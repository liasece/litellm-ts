import { describe, expect, it } from "vitest";
import { readTableValue, sortTableRows } from "./UiTableLogic";

describe("dashboard table ordering", () => {
	it("sorts numeric metrics numerically without mutating the fetched rows", () => {
		const rows = [
			{ id: "a", requests: 100 },
			{ id: "b", requests: 20 },
			{ id: "c", requests: 3 },
		];
		const sorted = sortTableRows(rows, [{ key: "requests", label: "Requests" }], { key: "requests", order: "asc" });
		expect(sorted.map((row) => row.id)).toEqual(["c", "b", "a"]);
		expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
	});

	it("keeps unavailable values last in either direction", () => {
		const rows = [
			{ id: "missing", latency: null },
			{ id: "slow", latency: 400 },
			{ id: "fast", latency: 20 },
		];
		const columns = [{ key: "latency", label: "Latency" }];
		expect(sortTableRows(rows, columns, { key: "latency", order: "asc" }).map((row) => row.id)).toEqual(["fast", "slow", "missing"]);
		expect(sortTableRows(rows, columns, { key: "latency", order: "desc" }).map((row) => row.id)).toEqual(["slow", "fast", "missing"]);
	});

	it("reads nested API metrics and safely handles absent intermediate data", () => {
		const column = { key: "cost", label: "Cost", dataIndex: ["metrics", "cost"] };
		expect(readTableValue({ metrics: { cost: 0 } }, column)).toBe(0);
		expect(readTableValue({ metrics: null }, column)).toBeUndefined();
	});
});
