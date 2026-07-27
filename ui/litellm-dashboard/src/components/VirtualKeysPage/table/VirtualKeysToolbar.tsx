import { SyncOutlined } from "@ant-design/icons";
import { Button, Skeleton } from "antd";
import TablePaginationControls from "../../common_components/TablePaginationControls";

interface VirtualKeysToolbarProps {
	loading: boolean;
	refreshing: boolean;
	rangeLabel: string;
	totalCount: number;
	pageIndex: number;
	pageCount: number;
	canPreviousPage: boolean;
	canNextPage: boolean;
	onRefresh: () => void;
	onPreviousPage: () => void;
	onNextPage: () => void;
}

export default function VirtualKeysToolbar({
	loading,
	refreshing,
	rangeLabel,
	totalCount,
	pageIndex,
	pageCount,
	canPreviousPage,
	canNextPage,
	onRefresh,
	onPreviousPage,
	onNextPage,
}: VirtualKeysToolbarProps) {
	return (
		<div className="mb-4 flex w-full items-center justify-between">
			<div className="inline-flex items-center gap-2">
				{loading ? (
					<Skeleton.Node active style={{ width: 200, height: 20 }} />
				) : (
					<span className="inline-flex text-sm text-gray-700">
						Showing {rangeLabel} of {totalCount} results
					</span>
				)}
				<Button
					type="default"
					icon={<SyncOutlined spin={refreshing} />}
					onClick={onRefresh}
					disabled={refreshing}
					title="Fetch data"
				>
					{refreshing ? "Fetching" : "Fetch"}
				</Button>
			</div>

			<TablePaginationControls
				loading={loading}
				pageIndex={pageIndex}
				pageCount={pageCount}
				canPreviousPage={canPreviousPage}
				canNextPage={canNextPage}
				onPreviousPage={onPreviousPage}
				onNextPage={onNextPage}
			/>
		</div>
	);
}
