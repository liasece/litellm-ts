import { LOGS_PAGE_SIZE_OPTIONS } from "./constants";

interface LogsPaginationProps {
	currentPage: number;
	pageSize: number;
	total: number;
	totalPages: number;
	loading: boolean;
	onPageChange: (page: number) => void;
	onPageSizeChange: (pageSize: number) => void;
}

export default function LogsPagination({
	currentPage,
	pageSize,
	total,
	totalPages,
	loading,
	onPageChange,
	onPageSizeChange,
}: LogsPaginationProps) {
	const firstResult = total > 0 ? (currentPage - 1) * pageSize + 1 : 0;
	const lastResult = Math.min(currentPage * pageSize, total);

	return (
		<div className="flex shrink-0 items-center gap-4 whitespace-nowrap">
			<span className="whitespace-nowrap text-sm text-gray-700">
				Showing {loading ? "..." : firstResult} - {loading ? "..." : lastResult} of {loading ? "..." : total} results
			</span>
			<div className="flex items-center space-x-2">
				<label className="text-sm text-gray-700" htmlFor="logs-page-size">
					Logs per page
				</label>
				<select
					id="logs-page-size"
					value={pageSize}
					onChange={(event) => onPageSizeChange(Number(event.target.value))}
					className="w-24 min-w-24 rounded-md border bg-white py-1 pl-3 pr-8 text-sm"
				>
					{LOGS_PAGE_SIZE_OPTIONS.map((size) => (
						<option key={size} value={size}>
							{size}
						</option>
					))}
				</select>
				<span className="min-w-[90px] text-sm text-gray-700">
					Page {loading ? "..." : currentPage} of {loading ? "..." : totalPages || 1}
				</span>
				<button
					onClick={() => onPageChange(Math.max(1, currentPage - 1))}
					disabled={loading || currentPage === 1}
					className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Previous
				</button>
				<button
					onClick={() => onPageChange(Math.min(totalPages || 1, currentPage + 1))}
					disabled={loading || currentPage === (totalPages || 1)}
					className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Next
				</button>
			</div>
		</div>
	);
}
