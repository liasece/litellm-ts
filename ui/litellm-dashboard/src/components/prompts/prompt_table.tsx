import { modelHubCall, type PromptSpec } from "@/components/networking";
import { Table, TableBody, TableHead } from "@tremor/react";
import { getCoreRowModel, getSortedRowModel, type SortingState, useReactTable } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import PromptTableHeader from "./prompt_table/PromptTableHeader";
import PromptTableRow from "./prompt_table/PromptTableRow";
import PromptTableStateRow from "./prompt_table/PromptTableStateRow";
import type { ModelGroupInfo } from "./prompt_table/types";
import usePromptColumns from "./prompt_table/usePromptColumns";

interface PromptTableProps {
	promptsList: PromptSpec[];
	isLoading: boolean;
	onPromptClick?: (id: string) => void;
	onDeleteClick?: (id: string, name: string) => void;
	accessToken: string | null;
	isAdmin: boolean;
}

export default function PromptTable({
	promptsList,
	isLoading,
	onPromptClick,
	onDeleteClick,
	accessToken,
	isAdmin,
}: PromptTableProps) {
	const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
	const [modelHubData, setModelHubData] = useState<Map<string, ModelGroupInfo>>(new Map());

	useEffect(() => {
		let active = true;

		const fetchModelHubData = async () => {
			if (!accessToken) {
				setModelHubData(new Map());
				return;
			}

			try {
				const response = await modelHubCall(accessToken);
				if (!active || !response?.data) return;

				setModelHubData(new Map(response.data.map((model: ModelGroupInfo) => [model.model_group, model])));
			} catch {
				if (active) setModelHubData(new Map());
			}
		};

		void fetchModelHubData();
		return () => {
			active = false;
		};
	}, [accessToken]);

	const columns = usePromptColumns({
		modelHubData,
		isAdmin,
		onPromptClick,
		onDeleteClick,
	});
	const table = useReactTable({
		data: promptsList,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		enableSorting: true,
	});

	return (
		<div className="custom-border relative rounded-lg">
			<div className="overflow-x-auto">
				<Table className="[&_td]:py-0.5 [&_th]:py-1">
					<TableHead>
						{table.getHeaderGroups().map((headerGroup) => (
							<PromptTableHeader key={headerGroup.id} headerGroup={headerGroup} />
						))}
					</TableHead>
					<TableBody>
						{isLoading ? (
							<PromptTableStateRow columnCount={columns.length} message="Loading..." />
						) : table.getRowModel().rows.length > 0 ? (
							table.getRowModel().rows.map((row) => <PromptTableRow key={row.id} row={row} />)
						) : (
							<PromptTableStateRow columnCount={columns.length} message="No prompts found" />
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
