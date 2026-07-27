import type { PromptSpec } from "@/components/networking";
import { ChevronDownIcon, ChevronUpIcon, SwitchVerticalIcon } from "@heroicons/react/outline";
import { TableHeaderCell, TableRow } from "@tremor/react";
import { flexRender, type HeaderGroup } from "@tanstack/react-table";

export default function PromptTableHeader({ headerGroup }: { headerGroup: HeaderGroup<PromptSpec> }) {
	return (
		<TableRow>
			{headerGroup.headers.map((header) => {
				const sorted = header.column.getIsSorted();
				return (
					<TableHeaderCell key={header.id} className="h-8 py-1" onClick={header.column.getToggleSortingHandler()}>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center">
								{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
							</div>
							<div className="w-4">
								{sorted === "asc" ? (
									<ChevronUpIcon className="h-4 w-4 text-blue-500" />
								) : sorted === "desc" ? (
									<ChevronDownIcon className="h-4 w-4 text-blue-500" />
								) : (
									<SwitchVerticalIcon className="h-4 w-4 text-gray-400" />
								)}
							</div>
						</div>
					</TableHeaderCell>
				);
			})}
		</TableRow>
	);
}
