import { Fragment, memo, useState } from "react";
import {
	ColumnDef,
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	HeaderGroup,
	Row,
	useReactTable,
	getSortedRowModel,
	SortingState,
} from "@tanstack/react-table";

import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@tremor/react";

interface DataTableProps<TData, TValue> {
	data: TData[];
	columns: ColumnDef<TData, TValue>[];
	onRowClick?: (row: TData) => void;
	/** Renders inside a single colspan cell (used by audit logs) */
	renderSubComponent?: (props: { row: Row<TData> }) => React.ReactElement;
	/** Renders directly in tbody as sibling table rows (used by MCP children) */
	renderChildRows?: (props: { row: Row<TData> }) => React.ReactNode;
	getRowCanExpand?: (row: Row<TData>) => boolean;
	isLoading?: boolean;
	loadingMessage?: string;
	noDataMessage?: string;
	/** Enable client-side column sorting (defaults to false to avoid conflicts with server-side sorting) */
	enableSorting?: boolean;
}

interface DataTableRowProps<TData, TValue> {
	row: Row<TData>;
	columns: ColumnDef<TData, TValue>[];
	onRowClick?: (row: TData) => void;
	renderSubComponent?: (props: { row: Row<TData> }) => React.ReactElement;
	renderChildRows?: (props: { row: Row<TData> }) => React.ReactNode;
	supportsExpansion: boolean;
	isExpanded: boolean;
}

interface DataTableHeaderProps<TData, TValue> {
	headerGroups: HeaderGroup<TData>[];
	columns: ColumnDef<TData, TValue>[];
	enableSorting: boolean;
	sorting: SortingState;
}

function DataTableHeader<TData, TValue>({ headerGroups, enableSorting }: DataTableHeaderProps<TData, TValue>) {
	return (
		<TableHead>
			{headerGroups.map((headerGroup) => (
				<TableRow key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						const canSort = enableSorting && header.column.getCanSort();
						const isSorted = header.column.getIsSorted();

						return (
							<TableHeaderCell
								key={header.id}
								className={`py-1 h-8 ${canSort ? "cursor-pointer select-none hover:bg-gray-50" : ""}`}
								onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
							>
								{header.isPlaceholder ? null : (
									<div className="flex items-center gap-1">
										{flexRender(header.column.columnDef.header, header.getContext())}
										{canSort && (
											<span className="text-gray-400">
												{isSorted === "asc" ? "↑" : isSorted === "desc" ? "↓" : "⇅"}
											</span>
										)}
									</div>
								)}
							</TableHeaderCell>
						);
					})}
				</TableRow>
			))}
		</TableHead>
	);
}

const MemoizedDataTableHeader = memo(
	DataTableHeader,
	(previous, next) =>
		previous.headerGroups === next.headerGroups &&
		previous.columns === next.columns &&
		previous.enableSorting === next.enableSorting &&
		previous.sorting === next.sorting,
) as typeof DataTableHeader;

function DataTableRow<TData, TValue>({
	row,
	onRowClick,
	renderSubComponent,
	renderChildRows,
	supportsExpansion,
	isExpanded,
}: DataTableRowProps<TData, TValue>) {
	return (
		<Fragment>
			<TableRow
				className={`h-8 ${onRowClick ? "cursor-pointer hover:bg-gray-50" : ""}`}
				onClick={() => onRowClick?.(row.original)}
			>
				{row.getVisibleCells().map((cell) => (
					<TableCell key={cell.id} className="py-0.5 max-h-8 overflow-hidden text-ellipsis whitespace-nowrap">
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</TableCell>
				))}
			</TableRow>

			{/* Child rows rendered as real table rows (MCP children) */}
			{supportsExpansion && isExpanded && renderChildRows && renderChildRows({ row })}

			{/* Legacy sub-component in colspan cell (audit logs) */}
			{supportsExpansion && isExpanded && renderSubComponent && !renderChildRows && (
				<TableRow>
					<TableCell colSpan={row.getVisibleCells().length} className="p-0">
						<div className="w-full max-w-full overflow-hidden box-border">{renderSubComponent({ row })}</div>
					</TableCell>
				</TableRow>
			)}
		</Fragment>
	);
}

const MemoizedDataTableRow = memo(
	DataTableRow,
	(previous, next) =>
		previous.row.id === next.row.id &&
		previous.row.original === next.row.original &&
		previous.columns === next.columns &&
		previous.onRowClick === next.onRowClick &&
		previous.renderSubComponent === next.renderSubComponent &&
		previous.renderChildRows === next.renderChildRows &&
		previous.supportsExpansion === next.supportsExpansion &&
		previous.isExpanded === next.isExpanded,
) as typeof DataTableRow;

function DataTableComponent<TData, TValue>({
	data = [],
	columns,
	onRowClick,
	renderSubComponent,
	renderChildRows,
	getRowCanExpand,
	isLoading = false,
	loadingMessage = "🚅 Loading logs...",
	noDataMessage = "No logs found",
	enableSorting = false,
}: DataTableProps<TData, TValue>) {
	const supportsExpansion = !!(renderSubComponent || renderChildRows) && !!getRowCanExpand;
	const [sorting, setSorting] = useState<SortingState>([]);

	const table = useReactTable<TData>({
		data,
		columns,
		...(enableSorting && {
			state: {
				sorting,
			},
			onSortingChange: setSorting,
			enableSortingRemoval: false,
		}),
		...(supportsExpansion && { getRowCanExpand }),
		getRowId: (row: TData, index: number) => {
			const _row: any = row as any;
			return _row?.request_id ?? String(index);
		},
		getCoreRowModel: getCoreRowModel(),
		...(enableSorting && { getSortedRowModel: getSortedRowModel() }),
		...(supportsExpansion && { getExpandedRowModel: getExpandedRowModel() }),
	});
	const headerGroups = table.getHeaderGroups();

	return (
		<div className="rounded-lg custom-border overflow-x-auto w-full max-w-full box-border">
			<Table className="[&_td]:py-0.5 [&_th]:py-1 table-fixed w-full box-border" style={{ minWidth: "400px" }}>
				<MemoizedDataTableHeader
					headerGroups={headerGroups}
					columns={columns}
					enableSorting={enableSorting}
					sorting={sorting}
				/>
				<TableBody>
					{isLoading ? (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-8 text-center">
								<div className="text-center text-gray-500">
									<p>{loadingMessage}</p>
								</div>
							</TableCell>
						</TableRow>
					) : table.getRowModel().rows.length > 0 ? (
						table
							.getRowModel()
							.rows.map((row) => (
								<MemoizedDataTableRow
									key={row.id}
									row={row}
									columns={columns}
									onRowClick={onRowClick}
									renderSubComponent={renderSubComponent}
									renderChildRows={renderChildRows}
									supportsExpansion={supportsExpansion}
									isExpanded={row.getIsExpanded()}
								/>
							))
					) : (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-8 text-center">
								<div className="text-center text-gray-500">
									<p>{noDataMessage}</p>
								</div>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

export const DataTable = memo(DataTableComponent) as typeof DataTableComponent;
