import { render } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable } from "./table";

interface TestRow {
	request_id: string;
	value: string;
}

describe("DataTable incremental rendering", () => {
	it("renders only inserted or changed rows when immutable data references are preserved", () => {
		const renderCounts = new Map<string, number>();
		let headerRenderCount = 0;
		const columns: ColumnDef<TestRow>[] = [
			{
				accessorKey: "value",
				header: () => {
					headerRenderCount += 1;
					return "Value";
				},
				cell: ({ row }) => {
					const id = row.original.request_id;
					renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
					return row.original.value;
				},
			},
		];
		const first = { request_id: "first", value: "First" };
		const second = { request_id: "second", value: "Second" };
		const inserted = { request_id: "inserted", value: "Inserted" };

		const { rerender } = render(<DataTable columns={columns} data={[first, second]} />);
		const firstInitialRenders = renderCounts.get(first.request_id);
		const secondInitialRenders = renderCounts.get(second.request_id);
		const initialHeaderRenderCount = headerRenderCount;

		rerender(<DataTable columns={columns} data={[inserted, first, second]} />);

		expect(renderCounts.get(inserted.request_id)).toBe(1);
		expect(renderCounts.get(first.request_id)).toBe(firstInitialRenders);
		expect(renderCounts.get(second.request_id)).toBe(secondInitialRenders);
		expect(headerRenderCount).toBe(initialHeaderRenderCount);

		const changedSecond = { ...second, value: "Second updated" };
		rerender(<DataTable columns={columns} data={[inserted, first, changedSecond]} />);

		expect(renderCounts.get(inserted.request_id)).toBe(1);
		expect(renderCounts.get(first.request_id)).toBe(firstInitialRenders);
		expect(renderCounts.get(second.request_id)).toBe((secondInitialRenders ?? 0) + 1);
		expect(headerRenderCount).toBe(initialHeaderRenderCount);
	});
});
