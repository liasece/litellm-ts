import { ChevronDownIcon, ChevronUpIcon, SwitchVerticalIcon } from "@heroicons/react/outline";
import { flexRender, type Table as ReactTable } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import type { UserInfo } from "../types";

interface UserTableContentProps {
	table: ReactTable<UserInfo>;
	columnCount: number;
	loading: boolean;
	onUserClick: (userId: string) => void;
}

export default function UserTableContent({ table, columnCount, loading, onUserClick }: UserTableContentProps) {
	return (
		<div className="overflow-auto">
			<div className="custom-border relative rounded-lg">
				<div className="overflow-x-auto">
					<Table className="[&_td]:py-0.5 [&_th]:py-1">
						<TableHead>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<TableHeaderCell
											key={header.id}
											className={`h-8 py-1 ${
												header.id === "actions"
													? "sticky right-0 bg-white shadow-[-4px_0_8px_-6px_rgba(0,0,0,0.1)]"
													: ""
											} ${header.column.getCanSort() ? "cursor-pointer hover:bg-gray-50" : ""}`}
											onClick={header.column.getToggleSortingHandler()}
										>
											<div className="flex items-center justify-between gap-2">
												<div className="flex items-center">
													{!header.isPlaceholder && flexRender(header.column.columnDef.header, header.getContext())}
												</div>
												{header.id !== "actions" && header.column.getCanSort() && (
													<div className="w-4">
														{header.column.getIsSorted() === "asc" ? (
															<ChevronUpIcon className="h-4 w-4 text-blue-500" />
														) : header.column.getIsSorted() === "desc" ? (
															<ChevronDownIcon className="h-4 w-4 text-blue-500" />
														) : (
															<SwitchVerticalIcon className="h-4 w-4 text-gray-400" />
														)}
													</div>
												)}
											</div>
										</TableHeaderCell>
									))}
								</TableRow>
							))}
						</TableHead>
						<TableBody>
							{loading ? (
								<TableRow>
									<TableCell colSpan={columnCount} className="h-8 text-center text-gray-500">
										🚅 Loading users...
									</TableCell>
								</TableRow>
							) : table.getRowModel().rows.length > 0 ? (
								table.getRowModel().rows.map((row) => (
									<TableRow key={row.id} className="h-8">
										{row.getVisibleCells().map((cell) => (
											<TableCell
												key={cell.id}
												className={`max-h-8 overflow-hidden text-ellipsis whitespace-nowrap py-0.5 ${
													cell.column.id === "actions"
														? "sticky right-0 bg-white shadow-[-4px_0_8px_-6px_rgba(0,0,0,0.1)]"
														: ""
												} ${cell.column.id === "user_id" ? "cursor-pointer text-blue-500" : ""}`}
												onClick={() => {
													if (cell.column.id === "user_id") onUserClick(cell.getValue() as string);
												}}
											>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										))}
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={columnCount} className="h-8 text-center text-gray-500">
										No users found
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}
