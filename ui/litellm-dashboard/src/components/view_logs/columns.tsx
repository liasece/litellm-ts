import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import type { ColumnDef } from "@tanstack/react-table";
import { Tooltip } from "antd";
import { ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";
import { getProviderLogoAndName } from "../provider_info_helpers";
import { TableHeaderSortDropdown } from "../common_components/TableHeaderSortDropdown/TableHeaderSortDropdown";
import { MetricProgress, MetricProgressCell } from "./MetricProgressCell";
import { TimeCell } from "./time_cell";
import ProviderLogo from "../common_components/ProviderLogo";

/** API sort field mapping for /spend/logs/ui endpoint */
export const LOGS_SORT_FIELD_MAP = {
	startTime: "startTime",
	spend: "spend",
	total_tokens: "total_tokens",
	request_duration_ms: "request_duration_ms",
} as const;

export type LogsSortField = keyof typeof LOGS_SORT_FIELD_MAP;

const MIN_OUTPUT_TOKENS_FOR_TPS = 20;
const DURATION_PROGRESS_MAX_SECONDS = 30;
const TOKEN_PROGRESS_MAX = {
	cacheRead: 200_000,
	input: 20_000,
	output: 2_000,
} as const;

export interface LogsSortProps {
	sortBy: LogsSortField;
	sortOrder: "asc" | "desc";
	onSortChange: (sortBy: LogsSortField, sortOrder: "asc" | "desc") => void;
	onKeyHashClick?: (keyHash: string) => void;
	onSessionClick?: (sessionGroup: SessionGroupRef) => void;
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

export type SessionGroupType = "claude_code_user_id" | "session_id";

export interface SessionGroupRef {
	type: SessionGroupType;
	id: string;
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
	session_group_type?: SessionGroupType;
	session_group_id?: string;
	status?: string;
	completionStartTime?: string;
	request_duration_ms?: number;
	session_total_count?: number;
	session_total_spend?: number;
	mcp_tool_call_count?: number;
	mcp_tool_call_spend?: number;
	onKeyHashClick?: (keyHash: string) => void;
	onSessionClick?: (sessionGroup: SessionGroupRef) => void;
};

export function getSessionGroupRef(
	log: Pick<LogEntry, "session_group_type" | "session_group_id" | "session_id">,
): SessionGroupRef | null {
	if (
		(log.session_group_type === "session_id" || log.session_group_type === "claude_code_user_id") &&
		typeof log.session_group_id === "string" &&
		log.session_group_id.length > 0
	) {
		return { type: log.session_group_type, id: log.session_group_id };
	}
	if (typeof log.session_id === "string" && log.session_id.length > 0) {
		return { type: "session_id", id: log.session_id };
	}
	return null;
}

export function getSessionGroupKey(group: SessionGroupRef): string {
	return `${group.type}\u0000${group.id}`;
}

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
			const rowStatus = info.row.original.status;
			const status = String(info.getValue() || rowStatus || "success").toLowerCase();
			const isInProgress = status === "in_progress";
			const isFailure = status === "failure";
			const isAborted = status === "aborted";

			return (
				<span
					className={`px-2 py-1 rounded-md text-xs font-medium inline-block text-center min-w-16 ${
						isInProgress
							? "bg-amber-100 text-amber-800"
							: isAborted
								? "bg-orange-100 text-orange-800"
								: isFailure
									? "bg-red-100 text-red-800"
									: "bg-green-100 text-green-800"
					}`}
				>
					{isInProgress ? "In Progress" : isAborted ? "Aborted" : isFailure ? "Failure" : "Success"}
				</span>
			);
		},
	},
	{
		header: "Session ID",
		id: "session_id",
		cell: (info: any) => {
			const row = info.row.original as LogEntry;
			const sessionGroup = getSessionGroupRef(row);
			if (!sessionGroup) return <span>-</span>;

			const sessionId = sessionGroup.id;
			const onSessionClick = sortProps?.onSessionClick ?? row.onSessionClick;
			if (!onSessionClick) {
				return (
					<Tooltip title={sessionId}>
						<span className="block max-w-[24ch] truncate font-mono text-xs">{sessionId}</span>
					</Tooltip>
				);
			}

			return (
				<Tooltip title={sessionId}>
					<a
						href={`#session-${encodeURIComponent(getSessionGroupKey(sessionGroup))}`}
						className="block max-w-[24ch] truncate font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline"
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onSessionClick(sessionGroup);
						}}
					>
						{sessionId}
					</a>
				</Tooltip>
			);
		},
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
			const durationSeconds = Number(ms) / 1000;
			const seconds = durationSeconds.toFixed(2);
			return (
				<MetricProgressCell
					ariaLabel={`Duration ${seconds} seconds`}
					color="red"
					displayValue={seconds}
					maxValue={DURATION_PROGRESS_MAX_SECONDS}
					progressTestId="duration-progress"
					tooltip={`${ms}ms`}
					value={durationSeconds}
				/>
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
			const onKeyHashClick = sortProps?.onKeyHashClick ?? info.row.original.onKeyHashClick;

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
					{provider && <ProviderLogo provider={provider} logo={getLogoUrl(row, provider)} />}
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
						className="grid w-72 grid-cols-3 whitespace-nowrap text-left font-mono tabular-nums text-sm text-current"
						aria-label={`Cache read ${cacheReadTokens}, input ${inputTokens}, output ${outputTokens}`}
						data-testid="tokens-three-column"
					>
						<MetricProgress
							ariaLabel={`Cache read ${cacheReadTokens} tokens`}
							className="flex min-w-0 w-full items-center overflow-hidden rounded px-1 text-left"
							color="green"
							maxValue={TOKEN_PROGRESS_MAX.cacheRead}
							progressTestId="cache-tokens-progress"
							value={cacheReadTokens}
						>
							<Database size={12} aria-hidden="true" />
							{formattedCacheReadTokens}
						</MetricProgress>
						<MetricProgress
							ariaLabel={`Input ${inputTokens} tokens`}
							className="flex min-w-0 w-full items-center overflow-hidden rounded px-1 text-left"
							color="green"
							maxValue={TOKEN_PROGRESS_MAX.input}
							progressTestId="input-tokens-progress"
							value={inputTokens}
						>
							<ArrowDownToLine size={12} aria-hidden="true" />
							{formattedInputTokens}
						</MetricProgress>
						<MetricProgress
							ariaLabel={`Output ${outputTokens} tokens`}
							className="flex min-w-0 w-full items-center overflow-hidden rounded px-1 text-left"
							color="green"
							maxValue={TOKEN_PROGRESS_MAX.output}
							progressTestId="output-tokens-progress"
							value={outputTokens}
						>
							<ArrowUpFromLine size={12} aria-hidden="true" />
							{formattedOutputTokens}
						</MetricProgress>
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
			if (!Number.isFinite(completionTokens) || completionTokens < MIN_OUTPUT_TOKENS_FOR_TPS) return null;
			const startMs = row.startTime ? new Date(row.startTime).getTime() : NaN;
			const endMs = row.endTime ? new Date(row.endTime).getTime() : NaN;
			const durationSec = (endMs - startMs) / 1000;
			if (!Number.isFinite(durationSec) || durationSec <= 0) return <span>-</span>;
			const tps = completionTokens / durationSec;
			return (
				<MetricProgressCell
					ariaLabel={`Output TPS ${tps.toFixed(1)}`}
					color="blue"
					displayValue={tps.toFixed(1)}
					maxValue={100}
					progressTestId="output-tps-progress"
					tooltip={`${completionTokens} tokens / ${durationSec.toFixed(2)}s`}
					value={tps}
				/>
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
