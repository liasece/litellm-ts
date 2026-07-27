import type { PromptSpec } from "@/components/networking";
import { TableCell, TableRow } from "@tremor/react";
import { flexRender, type Row } from "@tanstack/react-table";

export default function PromptTableRow({ row }: { row: Row<PromptSpec> }) {
	return (
		<TableRow className="h-8">
			{row.getVisibleCells().map((cell) => (
				<TableCell
					key={cell.id}
					className="max-h-8 overflow-hidden text-ellipsis whitespace-nowrap py-0.5"
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	);
}

