import type { KeyResponse } from "@/components/key_team_helpers/key_list";
import { TableCell, TableRow } from "@tremor/react";
import { flexRender, type Row } from "@tanstack/react-table";

export default function VirtualKeysTableRow({ row }: { row: Row<KeyResponse> }) {
	return (
		<TableRow className="h-8">
			{row.getVisibleCells().map((cell) => {
				const value = cell.getValue();
				const compactModels =
					cell.column.id === "models" && Array.isArray(value) && value.length > 3;
				return (
					<TableCell
						key={cell.id}
						style={{
							width: cell.column.getSize(),
							maxWidth: cell.column.getSize(),
							whiteSpace: "pre-wrap",
							overflow: "hidden",
						}}
						className={`max-h-8 overflow-hidden text-ellipsis whitespace-nowrap py-0.5 ${
							compactModels ? "px-0" : ""
						}`}
					>
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</TableCell>
				);
			})}
		</TableRow>
	);
}

