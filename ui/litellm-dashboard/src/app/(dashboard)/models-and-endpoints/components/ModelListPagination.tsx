import { Skeleton } from "antd";

interface PaginationMeta {
	total_count: number;
	total_pages: number;
}

interface ModelListPaginationProps {
	currentPage: number;
	pageSize: number;
	pagination: PaginationMeta;
	isLoading: boolean;
	onPageChange: (page: number) => void;
}

export default function ModelListPagination({
	currentPage,
	pageSize,
	pagination,
	isLoading,
	onPageChange,
}: ModelListPaginationProps) {
	const firstResult = (currentPage - 1) * pageSize + 1;
	const lastResult = Math.min(currentPage * pageSize, pagination.total_count);

	return (
		<div className="flex items-center justify-between">
			{isLoading ? (
				<Skeleton.Input active style={{ width: 184, height: 20 }} />
			) : (
				<span className="text-sm text-gray-700">
					{pagination.total_count > 0
						? `Showing ${firstResult} - ${lastResult} of ${pagination.total_count} results`
						: "Showing 0 results"}
				</span>
			)}

			<div className="flex items-center space-x-2">
				{isLoading ? (
					<Skeleton.Button active style={{ width: 84, height: 30 }} />
				) : (
					<button
						type="button"
						onClick={() => onPageChange(currentPage - 1)}
						disabled={currentPage === 1}
						className={`rounded-md border px-3 py-1 text-sm ${
							currentPage === 1 ? "cursor-not-allowed bg-gray-100 text-gray-400" : "hover:bg-gray-50"
						}`}
					>
						Previous
					</button>
				)}

				{isLoading ? (
					<Skeleton.Button active style={{ width: 56, height: 30 }} />
				) : (
					<button
						type="button"
						onClick={() => onPageChange(currentPage + 1)}
						disabled={currentPage >= pagination.total_pages}
						className={`rounded-md border px-3 py-1 text-sm ${
							currentPage >= pagination.total_pages
								? "cursor-not-allowed bg-gray-100 text-gray-400"
								: "hover:bg-gray-50"
						}`}
					>
						Next
					</button>
				)}
			</div>
		</div>
	);
}
