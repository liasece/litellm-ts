import { Skeleton } from "antd";

interface TablePaginationControlsProps {
	loading: boolean;
	pageIndex: number;
	pageCount: number;
	canPreviousPage: boolean;
	canNextPage: boolean;
	onPreviousPage: () => void;
	onNextPage: () => void;
}

export default function TablePaginationControls({
	loading,
	pageIndex,
	pageCount,
	canPreviousPage,
	canNextPage,
	onPreviousPage,
	onNextPage,
}: TablePaginationControlsProps) {
	return (
		<div className="inline-flex items-center gap-2">
			{loading ? (
				<Skeleton.Node active style={{ width: 74, height: 20 }} />
			) : (
				<span className="text-sm text-gray-700">
					Page {pageIndex + 1} of {pageCount}
				</span>
			)}
			{loading ? (
				<Skeleton.Button active size="small" style={{ width: 84, height: 30 }} />
			) : (
				<button
					type="button"
					onClick={onPreviousPage}
					disabled={!canPreviousPage}
					className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Previous
				</button>
			)}
			{loading ? (
				<Skeleton.Button active size="small" style={{ width: 58, height: 30 }} />
			) : (
				<button
					type="button"
					onClick={onNextPage}
					disabled={!canNextPage}
					className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Next
				</button>
			)}
		</div>
	);
}
