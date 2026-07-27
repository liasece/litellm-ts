import type { PromptSpec } from "@/components/networking";
import ProviderLogo from "@/components/common_components/ProviderLogo";
import { getProviderLogoAndName } from "@/components/provider_info_helpers";
import { CopyOutlined } from "@ant-design/icons";
import { TrashIcon } from "@heroicons/react/outline";
import { Button } from "@tremor/react";
import { Tooltip } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { extractModel, getProviderFromModelHub } from "../prompt_utils";
import type { ModelGroupInfo } from "./types";

interface UsePromptColumnsOptions {
	modelHubData: Map<string, ModelGroupInfo>;
	isAdmin: boolean;
	onPromptClick?: (id: string) => void;
	onDeleteClick?: (id: string, name: string) => void;
}

function formatDate(value?: string) {
	return value ? new Date(value).toLocaleString() : "-";
}

export default function usePromptColumns({
	modelHubData,
	isAdmin,
	onPromptClick,
	onDeleteClick,
}: UsePromptColumnsOptions): ColumnDef<PromptSpec>[] {
	return useMemo(() => {
		const columns: ColumnDef<PromptSpec>[] = [
			{
				header: "Prompt ID",
				accessorKey: "prompt_id",
				cell: ({ getValue }) => {
					const promptId = String(getValue() || "");
					const displayId = promptId.length > 25 ? `${promptId.slice(0, 25)}...` : promptId;

					return (
						<div className="flex items-center gap-2">
							<Tooltip title={promptId}>
								<Button
									size="xs"
									variant="light"
									className="min-w-[220px] justify-start overflow-hidden truncate bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
									onClick={() => promptId && onPromptClick?.(promptId)}
								>
									{displayId}
								</Button>
							</Tooltip>
							<Tooltip title="Copy prompt ID">
								<CopyOutlined
									onClick={(event) => {
										event.stopPropagation();
										void navigator.clipboard.writeText(promptId);
									}}
									className="cursor-pointer text-xs text-gray-500 hover:text-blue-500"
								/>
							</Tooltip>
						</div>
					);
				},
			},
			{
				header: "Model",
				id: "model",
				accessorFn: (prompt) => extractModel(prompt),
				cell: ({ row }) => {
					const model = extractModel(row.original);
					if (!model) return <span className="text-xs text-gray-400">-</span>;

					const provider = getProviderFromModelHub(model, modelHubData);
					const { logo } = getProviderLogoAndName(provider || "");

					return (
						<Tooltip title={model}>
							<div className="flex items-center space-x-2">
								<div className="flex-shrink-0">
									<ProviderLogo provider={provider || ""} logo={logo} />
								</div>
								<span className="block max-w-[15ch] truncate">{model}</span>
							</div>
						</Tooltip>
					);
				},
			},
			{
				header: "Created At",
				accessorKey: "created_at",
				cell: ({ row }) => (
					<Tooltip title={row.original.created_at}>
						<span className="text-xs">{formatDate(row.original.created_at)}</span>
					</Tooltip>
				),
			},
			{
				header: "Updated At",
				accessorKey: "updated_at",
				cell: ({ row }) => (
					<Tooltip title={row.original.updated_at}>
						<span className="text-xs">{formatDate(row.original.updated_at)}</span>
					</Tooltip>
				),
			},
			{
				header: "Type",
				accessorKey: "prompt_info.prompt_type",
				cell: ({ row }) => (
					<Tooltip title={row.original.prompt_info?.prompt_type}>
						<span className="text-xs">{row.original.prompt_info?.prompt_type || "-"}</span>
					</Tooltip>
				),
			},
		];

		if (isAdmin) {
			columns.push({
				header: "Actions",
				id: "actions",
				enableSorting: false,
				cell: ({ row }) => {
					const promptId = row.original.prompt_id;
					return (
						<Tooltip title="Delete prompt">
							<Button
								size="xs"
								variant="light"
								color="red"
								onClick={(event) => {
									event.stopPropagation();
									onDeleteClick?.(promptId, promptId || "Unknown Prompt");
								}}
								icon={TrashIcon}
								className="text-red-500 hover:bg-red-50 hover:text-red-700"
							/>
						</Tooltip>
					);
				},
			});
		}

		return columns;
	}, [isAdmin, modelHubData, onDeleteClick, onPromptClick]);
}
