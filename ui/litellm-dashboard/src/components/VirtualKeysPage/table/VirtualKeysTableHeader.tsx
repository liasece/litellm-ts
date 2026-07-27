import type { KeyResponse } from "@/components/key_team_helpers/key_list";
import { ChevronDownIcon, ChevronUpIcon, SwitchVerticalIcon } from "@heroicons/react/outline";
import { TableHeaderCell, TableRow } from "@tremor/react";
import { flexRender, type HeaderGroup } from "@tanstack/react-table";

export default function VirtualKeysTableHeader({
	headerGroup,
	resizeDirection,
}: {
	headerGroup: HeaderGroup<KeyResponse>;
	resizeDirection: "ltr" | "rtl";
}) {
	return (
		<TableRow>
			{headerGroup.headers.map((header) => {
				const sorted = header.column.getIsSorted();
				const resizing = header.column.getIsResizing();
				return (
					<TableHeaderCell
						key={header.id}
						data-header-id={header.id}
						className={`group relative h-8 py-1 hover:bg-gray-50 ${
							header.id === "actions" ? "sticky right-0 bg-white shadow-[-4px_0_8px_-6px_rgba(0,0,0,0.1)]" : ""
						}`}
						style={{
							width: header.getSize(),
							cursor: header.column.getCanSort() ? "pointer" : "default",
						}}
						onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
					>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center">
								{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
							</div>
							{header.id !== "actions" && header.column.getCanSort() && (
								<div className="w-4">
									{sorted === "asc" ? (
										<ChevronUpIcon className="h-4 w-4 text-blue-500" />
									) : sorted === "desc" ? (
										<ChevronDownIcon className="h-4 w-4 text-blue-500" />
									) : (
										<SwitchVerticalIcon className="h-4 w-4 text-gray-400" />
									)}
								</div>
							)}
							<div
								role="separator"
								aria-orientation="vertical"
								onDoubleClick={() => header.column.resetSize()}
								onMouseDown={header.getResizeHandler()}
								onTouchStart={header.getResizeHandler()}
								className={`resizer absolute right-0 top-0 h-full w-[5px] cursor-col-resize touch-none select-none group-hover:opacity-50 ${resizeDirection} ${resizing ? "bg-blue-500 opacity-100" : "bg-transparent opacity-0"}`}
							/>
						</div>
					</TableHeaderCell>
				);
			})}
		</TableRow>
	);
}
