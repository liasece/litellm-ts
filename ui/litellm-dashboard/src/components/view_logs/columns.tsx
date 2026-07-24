import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@tremor/react";
import { Tooltip } from "antd";
import { ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";
import React, { useState } from "react";
import { getProviderLogoAndName } from "../provider_info_helpers";
import { TableHeaderSortDropdown } from "../common_components/TableHeaderSortDropdown/TableHeaderSortDropdown";
import { TimeCell } from "./time_cell";

/** API sort field mapping for /spend/logs/ui endpoint */
export const LOGS_SORT_FIELD_MAP = {
	startTime: "startTime",
	spend: "spend",
	total_tokens: "total_tokens",
	request_duration_ms: "request_duration_ms",
} as const;

export type LogsSortField = keyof typeof LOGS_SORT_FIELD_MAP;

export interface LogsSortProps {
	sortBy: LogsSortField;
	sortOrder: "asc" | "desc";
	onSortChange: (sortBy: LogsSortField, sortOrder: "asc" | "desc") => void;
}

// Helper to get the appropriate logo URL
const getDisplayModelName = (model: string, provider?: string): string => {
	if (!provider) return model;
	const prefix = `${provider}/`;
	return model.toLowerCase().startsWith(prefix.toLowerCase()) ? model.slice(prefix.length) : model;
};

const getLogoUrl = (row: LogEntry, provider: string) => {
	// Check if mcp_tool_call_metadata exists and contains mcp_server_logo_url
	if (row.metadata?.mcp_tool_call_metadata?.mcp_server_logo_url) {
		return row.metadata.mcp_tool_call_metadata.mcp_server_logo_url;
	}
	// Fall back to default provider logo
	return provider ? getProviderLogoAndName(provider).logo : "";
};

export interface ModelResolutionChainEntry {
	fallback_index: number;
	input_model: string;
	resolved_model: string;
	resolution_path: string[];
}

export function normalizeModelResolutionChain(value: unknown): ModelResolutionChainEntry[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			!Number.isInteger((entry as any).fallback_index) ||
			(entry as any).fallback_index < 0 ||
			typeof (entry as any).input_model !== "string" ||
			typeof (entry as any).resolved_model !== "string" ||
			!Array.isArray((entry as any).resolution_path) ||
			(entry as any).resolution_path.length <= 1 ||
			!(entry as any).resolution_path.every((node: unknown) => typeof node === "string")
		) {
			return [];
		}
		return [
			{
				...(entry as ModelResolutionChainEntry),
				resolution_path: [...(entry as ModelResolutionChainEntry).resolution_path],
			},
		];
	});
}

export type LogEntry = {
	request_id: string;
	api_key: string;
	team_id: string;
	model: string;
	model_id: string;
	api_base?: string;
	call_type: string;
	spend: number;
	total_tokens: number;
	prompt_tokens: number;
	completion_tokens: number;
	startTime: string;
	endTime: string;
	user?: string;
	end_user?: string;
	custom_llm_provider?: string;
	metadata?: Record<string, any>;
	cache_hit: string;
	cache_key?: string;
	request_tags?: Record<string, any>;
	requester_ip_address?: string;
	messages: string | any[] | Record<string, any>;
	response: string | any[] | Record<string, any>;
	proxy_server_request?: string | any[] | Record<string, any>;
	session_id?: string;
	status?: string;
	completionStartTime?: string;
	request_duration_ms?: number;
	session_total_count?: number;
	session_total_spend?: number;
	mcp_tool_call_count?: number;
	mcp_tool_call_spend?: number;
	onKeyHashClick?: (keyHash: string) => void;
	onSessionClick?: (sessionId: string) => void;
};

const SortableHeader = ({
	label,
	field,
	sortBy,
	sortOrder,
	onSortChange,
}: {
	label: string;
	field: LogsSortField;
	sortBy: LogsSortField;
	sortOrder: "asc" | "desc";
	onSortChange: (sortBy: LogsSortField, sortOrder: "asc" | "desc") => void;
}) => (
	<div className="flex items-center gap-1">
		<span>{label}</span>
		<TableHeaderSortDropdown
			sortState={sortBy === field ? sortOrder : false}
			onSortChange={(newState) => {
				if (newState === false) {
					onSortChange("startTime", "desc");
				} else {
					onSortChange(field, newState);
				}
			}}
		/>
	</div>
);

export const createColumns = (sortProps?: LogsSortProps): ColumnDef<LogEntry>[] => [
	{
		header: sortProps
			? () => (
					<SortableHeader
						label="Time"
						field="startTime"
						sortBy={sortProps.sortBy}
						sortOrder={sortProps.sortOrder}
						onSortChange={sortProps.onSortChange}
					/>
				)
			: "Time",
		accessorKey: "startTime",
		cell: (info: any) => <TimeCell utcTime={info.getValue()} />,
	},
	{
		header: "Status",
		accessorKey: "metadata.status",
		cell: (info: any) => {
			const status = info.getValue() || "Success";
			const isSuccess = status.toLowerCase() !== "failure";

			return (
				<span
					className={`px-2 py-1 rounded-md text-xs font-medium inline-block text-center w-16 ${
						isSuccess ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
					}`}
				>
					{isSuccess ? "Success" : "Failure"}
				</span>
			);
		},
	},
	{
		header: "Request ID",
		accessorKey: "request_id",
		cell: (info: any) => (
			<Tooltip title={String(info.getValue() || "")}>
				<span className="font-mono text-xs max-w-[25ch] truncate block">{String(info.getValue() || "")}</span>
			</Tooltip>
		),
	},
	{
		header: sortProps
			? () => (
					<SortableHeader
						label="Cost"
						field="spend"
						sortBy={sortProps.sortBy}
						sortOrder={sortProps.sortOrder}
						onSortChange={sortProps.onSortChange}
					/>
				)
			: "Cost",
		accessorKey: "spend",
		cell: (info: any) => {
			const row = info.row.original;
			const mcpCount = row.mcp_tool_call_count || 0;
			const mcpSpend = row.mcp_tool_call_spend || 0;

			return (
				<div className="flex flex-col">
					<Tooltip title={`$${String(info.getValue() || 0)}`}>
						<span>{getSpendString(info.getValue() || 0)}</span>
					</Tooltip>
					{mcpCount > 0 && mcpSpend > 0 && (
						<span className="text-[10px] text-amber-600">
							incl. {getSpendString(mcpSpend)} from {mcpCount} MCP
						</span>
					)}
				</div>
			);
		},
	},
	{
		header: sortProps
			? () => (
					<SortableHeader
						label="Duration (s)"
						field="request_duration_ms"
						sortBy={sortProps.sortBy}
						sortOrder={sortProps.sortOrder}
						onSortChange={sortProps.onSortChange}
					/>
				)
			: "Duration (s)",
		accessorKey: "request_duration_ms",
		cell: (info: any) => {
			const ms = info.getValue();
			if (ms == null) return <span>-</span>;
			const seconds = (ms / 1000).toFixed(2);
			return (
				<Tooltip title={`${ms}ms`}>
					<span className="max-w-[25ch] truncate block">{seconds}</span>
				</Tooltip>
			);
		},
	},
	{
		header: "TTFT (s)",
		accessorKey: "completionStartTime",
		cell: (info: any) => {
			const row = info.row.original;
			const completionStartTime = info.getValue();
			if (!completionStartTime) return <span>-</span>;
			// TTFT = completionStartTime - startTime（上游开始响应时刻 - 请求到达时刻）。
			// 非流式 cst 与 endTime 同毫秒为正常边界（Python 亦如此），不再据此隐藏。
			const ttftMs = new Date(completionStartTime).getTime() - new Date(row.startTime).getTime();
			if (ttftMs <= 0) return <span>-</span>;
			const ttftSeconds = (ttftMs / 1000).toFixed(2);
			return (
				<Tooltip title={`${ttftMs}ms`}>
					<span className="max-w-[25ch] truncate block">{ttftSeconds}</span>
				</Tooltip>
			);
		},
	},
	{
		header: "Key Name",
		accessorKey: "metadata.user_api_key_alias",
		cell: (info: any) => {
			const alias = String(info.getValue() || "-");
			// 点击打开 key 详情页：复用原 Key Hash 列的 onKeyHashClick 行为，
			// key 标识取 metadata.user_api_key（哈希值）
			const keyHash = String(info.row.original?.metadata?.user_api_key || "");
			const onKeyHashClick = info.row.original.onKeyHashClick;

			return (
				<Tooltip title={alias}>
					<span
						className="max-w-[25ch] truncate block cursor-pointer hover:text-blue-600"
						onClick={() => keyHash && onKeyHashClick?.(keyHash)}
					>
						{alias}
					</span>
				</Tooltip>
			);
		},
	},
	{
		header: "Model",
		accessorKey: "model",
		cell: (info: any) => {
			const row = info.row.original;
			const provider = row.custom_llm_provider;
			const modelName = String(info.getValue() || "");
			const displayModelName = getDisplayModelName(modelName, provider);
			const fallbackModels: string[] | undefined = row.metadata?.fallback_models;
			const fallbackCount = fallbackModels && fallbackModels.length > 1 ? fallbackModels.length - 1 : 0;
			const fallbackTooltip =
				fallbackModels && fallbackModels.length > 1
					? fallbackModels
							.map((m: string, i: number) => {
								const name = getDisplayModelName(m, provider);
								return i === 0 ? name : "\u2192 " + name;
							})
							.join(" ")
					: undefined;
			const resolutionTooltip = normalizeModelResolutionChain(row.metadata?.model_resolution_chain)
				.map(
					(entry) =>
						`${entry.fallback_index === 0 ? "Request" : `Fallback ${entry.fallback_index}`}: ${entry.resolution_path.join(" → ")}`,
				)
				.join("\n");
			const modelTooltip = [resolutionTooltip || undefined, fallbackTooltip].filter(Boolean).join("\n") || modelName;
			return (
				<div className="flex items-center space-x-2">
					{provider && (
						<img
							src={getLogoUrl(row, provider)}
							alt=""
							className="w-4 h-4"
							onError={(e) => {
								const target = e.target as HTMLImageElement;
								target.style.display = "none";
							}}
						/>
					)}
					<Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{modelTooltip}</span>}>
						<span className="max-w-[25ch] truncate block">
							{fallbackCount > 0 && (
								<Tooltip title={fallbackTooltip}>
									<span className="text-gray-400 mr-0.5 cursor-help">({fallbackCount})</span>
								</Tooltip>
							)}
							{displayModelName}
						</span>
					</Tooltip>
				</div>
			);
		},
	},
	{
		header: sortProps
			? () => (
					<SortableHeader
						label="Tokens"
						field="total_tokens"
						sortBy={sortProps.sortBy}
						sortOrder={sortProps.sortOrder}
						onSortChange={sortProps.onSortChange}
					/>
				)
			: "Tokens",
		accessorKey: "total_tokens",
		cell: (info: any) => {
			const row = info.row.original;
			const additionalUsage = row.metadata?.additional_usage_values;
			const rawCacheReadTokens = Number(additionalUsage?.cache_read_input_tokens ?? 0);
			const rawCacheCreationTokens = Number(additionalUsage?.cache_creation_input_tokens ?? 0);
			const rawPromptTokens = Number(row.prompt_tokens ?? 0);
			const rawOutputTokens = Number(row.completion_tokens ?? 0);
			const cacheReadTokens = Number.isFinite(rawCacheReadTokens) ? Math.max(rawCacheReadTokens, 0) : 0;
			const cacheCreationTokens = Number.isFinite(rawCacheCreationTokens) ? Math.max(rawCacheCreationTokens, 0) : 0;
			const promptTokens = Number.isFinite(rawPromptTokens) ? Math.max(rawPromptTokens, 0) : 0;
			const outputTokens = Number.isFinite(rawOutputTokens) ? Math.max(rawOutputTokens, 0) : 0;
			const inputTokens = Math.max(promptTokens - cacheReadTokens, 0);
			const formattedCacheReadTokens = formatNumberWithCommas(cacheReadTokens, 0, false);
			const formattedInputTokens = formatNumberWithCommas(inputTokens, 0, false);
			const formattedOutputTokens = formatNumberWithCommas(outputTokens, 0, false);
			const tooltip = (
				<div>
					<div>Cache read + input / output</div>
					{cacheCreationTokens > 0 && (
						<div>Cache creation: {formatNumberWithCommas(cacheCreationTokens, 0, false)} (included in input)</div>
					)}
				</div>
			);

			return (
				<Tooltip title={tooltip}>
					<span
						className="inline-grid min-w-56 grid-cols-3 gap-x-4 whitespace-nowrap text-left font-mono tabular-nums text-sm text-current"
						aria-label={`Cache read ${cacheReadTokens}, input ${inputTokens}, output ${outputTokens}`}
						data-testid="tokens-three-column"
					>
						<span className="flex min-w-16 items-center gap-1 text-left" data-testid="token-column">
							<Database size={12} aria-hidden="true" />
							{formattedCacheReadTokens}
						</span>
						<span className="flex min-w-16 items-center gap-1 text-left" data-testid="token-column">
							<ArrowDownToLine size={12} aria-hidden="true" />
							{formattedInputTokens}
						</span>
						<span className="flex min-w-16 items-center gap-1 text-left" data-testid="token-column">
							<ArrowUpFromLine size={12} aria-hidden="true" />
							{formattedOutputTokens}
						</span>
					</span>
				</Tooltip>
			);
		},
	},
	{
		// 输出速率：completion_tokens / (endTime - startTime)，衡量模型吐字速度
		header: "输出 TPS",
		id: "output_tps",
		cell: (info: any) => {
			const row = info.row.original;
			const completionTokens = Number(row.completion_tokens || 0);
			const startMs = row.startTime ? new Date(row.startTime).getTime() : NaN;
			const endMs = row.endTime ? new Date(row.endTime).getTime() : NaN;
			const durationSec = (endMs - startMs) / 1000;
			if (!completionTokens || !Number.isFinite(durationSec) || durationSec <= 0) return <span>-</span>;
			const tps = completionTokens / durationSec;
			return (
				<Tooltip title={`${completionTokens} tokens / ${durationSec.toFixed(2)}s`}>
					<span className="text-sm">{tps.toFixed(1)}</span>
				</Tooltip>
			);
		},
	},
	{
		header: "Internal User",
		accessorKey: "user",
		cell: (info: any) => (
			<Tooltip title={String(info.getValue() || "-")}>
				<span className="max-w-[25ch] truncate block">{String(info.getValue() || "-")}</span>
			</Tooltip>
		),
	},
	{
		header: "End User",
		accessorKey: "end_user",
		cell: (info: any) => (
			<Tooltip title={String(info.getValue() || "-")}>
				<span className="max-w-[25ch] truncate block">{String(info.getValue() || "-")}</span>
			</Tooltip>
		),
	},

	{
		header: "Tags",
		accessorKey: "request_tags",
		cell: (info: any) => {
			const tags = info.getValue();
			if (!tags || Object.keys(tags).length === 0) return "-";

			const tagEntries = Object.entries(tags);
			const firstTag = tagEntries[0];
			const remainingTags = tagEntries.slice(1);

			return (
				<div className="flex flex-wrap gap-1">
					<Tooltip
						title={
							<div className="flex flex-col gap-1">
								{tagEntries.map(([key, value]) => (
									<span key={key}>
										{key}: {String(value)}
									</span>
								))}
							</div>
						}
					>
						<span className="px-2 py-1 bg-gray-100 rounded-full text-xs">
							{firstTag[0]}: {String(firstTag[1])}
							{remainingTags.length > 0 && ` +${remainingTags.length}`}
						</span>
					</Tooltip>
				</div>
			);
		},
	},
];

/** Default columns without sort (for backward compatibility) */
export const columns = createColumns();

const formatMessage = (message: any): string => {
	if (!message) return "N/A";
	if (typeof message === "string") return message;
	if (typeof message === "object") {
		// Handle the {text, type} object specifically
		if (message.text) return message.text;
		if (message.content) return message.content;
		return JSON.stringify(message);
	}
	return String(message);
};

// Add this new component for displaying request/response with copy buttons
export const RequestResponsePanel = ({ request, response }: { request: any; response: any }) => {
	const requestStr = typeof request === "object" ? JSON.stringify(request, null, 2) : String(request || "{}");
	const responseStr = typeof response === "object" ? JSON.stringify(response, null, 2) : String(response || "{}");

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
		} catch (err) {
			console.error("Failed to copy text: ", err);
		}
	};

	return (
		<div className="grid grid-cols-2 gap-4 mt-4">
			<div className="rounded-lg border border-gray-200 bg-gray-50">
				<div className="flex justify-between items-center p-3 border-b border-gray-200">
					<h3 className="text-sm font-medium">Request</h3>
					<button
						onClick={() => copyToClipboard(requestStr)}
						className="p-1 hover:bg-gray-200 rounded"
						title="Copy request"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
						</svg>
					</button>
				</div>
				<pre className="p-4 overflow-auto text-xs font-mono h-64 whitespace-pre-wrap break-words">{requestStr}</pre>
			</div>

			<div className="rounded-lg border border-gray-200 bg-gray-50">
				<div className="flex justify-between items-center p-3 border-b border-gray-200">
					<h3 className="text-sm font-medium">Response</h3>
					<button
						onClick={() => copyToClipboard(responseStr)}
						className="p-1 hover:bg-gray-200 rounded"
						title="Copy response"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
						</svg>
					</button>
				</div>
				<pre className="p-4 overflow-auto text-xs font-mono h-64 whitespace-pre-wrap break-words">{responseStr}</pre>
			</div>
		</div>
	);
};

// New component for collapsible JSON display
const CollapsibleJsonCell = ({ jsonData }: { jsonData: any }) => {
	const [isExpanded, setIsExpanded] = React.useState(false);
	const jsonString = JSON.stringify(jsonData, null, 2);

	if (!jsonData || Object.keys(jsonData).length === 0) {
		return <span>-</span>;
	}

	return (
		<div>
			<button onClick={() => setIsExpanded(!isExpanded)} className="text-blue-500 hover:text-blue-700 text-xs">
				{isExpanded ? "Hide JSON" : "Show JSON"} ({Object.keys(jsonData).length} fields)
			</button>
			{isExpanded && (
				<pre className="mt-2 p-2 bg-gray-50 border rounded text-xs overflow-auto max-h-60">{jsonString}</pre>
			)}
		</div>
	);
};

export type AuditLogEntry = {
	id: string;
	updated_at: string;
	changed_by: string;
	changed_by_api_key: string;
	action: string;
	table_name: string;
	object_id: string;
	before_value: Record<string, any>;
	updated_values: Record<string, any>;
};

const getActionBadge = (action: string) => {
	return (
		<Badge color="gray" className="flex items-center gap-1">
			<span className="whitespace-nowrap text-xs">{action}</span>
		</Badge>
	);
};

export const auditLogColumns: ColumnDef<AuditLogEntry>[] = [
	{
		id: "expander",
		header: () => null,
		cell: ({ row }) => {
			const ExpanderCell = () => {
				const [localExpanded, setLocalExpanded] = React.useState(row.getIsExpanded());

				const toggleHandler = React.useCallback(() => {
					setLocalExpanded((prev) => !prev);
					row.getToggleExpandedHandler()();
				}, [row]);

				return row.getCanExpand() ? (
					<button
						onClick={toggleHandler}
						style={{ cursor: "pointer" }}
						aria-label={localExpanded ? "Collapse row" : "Expand row"}
						className="w-6 h-6 flex items-center justify-center focus:outline-none"
					>
						<svg
							className={`w-4 h-4 transform transition-transform ${localExpanded ? "rotate-90" : ""}`}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</button>
				) : (
					<span className="w-6 h-6 flex items-center justify-center">●</span>
				);
			};
			return <ExpanderCell />;
		},
	},
	{
		header: "Timestamp",
		accessorKey: "updated_at",
		cell: (info: any) => <TimeCell utcTime={info.getValue()} />,
	},
	{
		header: "Table Name",
		accessorKey: "table_name",
		cell: (info: any) => {
			const tableName = info.getValue();
			let displayValue = tableName;
			switch (tableName) {
				case "LiteLLM_VerificationToken":
					displayValue = "Keys";
					break;
				case "LiteLLM_TeamTable":
					displayValue = "Teams";
					break;
				case "LiteLLM_OrganizationTable":
					displayValue = "Organizations";
					break;
				case "LiteLLM_UserTable":
					displayValue = "Users";
					break;
				case "LiteLLM_ProxyModelTable":
					displayValue = "Models";
					break;
				default:
					displayValue = tableName;
			}
			return <span>{displayValue}</span>;
		},
	},
	{
		header: "Action",
		accessorKey: "action",
		cell: (info: any) => <span>{getActionBadge(info.getValue())}</span>,
	},
	{
		header: "Changed By",
		accessorKey: "changed_by",
		cell: (info: any) => {
			const changedBy = info.row.original.changed_by;
			const apiKey = info.row.original.changed_by_api_key;
			return (
				<div className="space-y-1">
					<div className="font-medium">{changedBy}</div>
					{apiKey && ( // Only show API key if it exists
						<Tooltip title={apiKey}>
							<div className="text-xs text-muted-foreground max-w-[25ch] truncate">
								{" "}
								{/* Apply max-width and truncate */}
								{apiKey}
							</div>
						</Tooltip>
					)}
				</div>
			);
		},
	},
	{
		header: "Affected Item ID",
		accessorKey: "object_id",
		cell: (props) => {
			const ObjectIdDisplay = () => {
				const objectId = props.getValue();
				const [copied, setCopied] = useState(false);

				if (!objectId) return <>-</>;

				const handleCopy = async () => {
					try {
						await navigator.clipboard.writeText(String(objectId));
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					} catch (err) {
						console.error("Failed to copy object ID: ", err);
					}
				};

				return (
					<Tooltip title={copied ? "Copied!" : String(objectId)}>
						<span className="max-w-[20ch] truncate block cursor-pointer hover:text-blue-600" onClick={handleCopy}>
							{String(objectId)}
						</span>
					</Tooltip>
				);
			};
			return <ObjectIdDisplay />;
		},
	},
];
