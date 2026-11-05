import { Fragment } from "react";

import { Money, useMoneyFormatter } from "@/contexts/PriceDisplay";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import type { ColumnDef } from "@tanstack/react-table";
import { Popover, Tag, Tooltip } from "antd";
import { ArrowDownToLine, ArrowUpFromLine, CircleDollarSign, Database, GitBranch } from "lucide-react";
import { getModelLogoAndName, getProviderLogoAndName } from "../provider_info_helpers";
import LabeledField from "../common_components/LabeledField";
import { TableHeaderSortDropdown } from "../common_components/TableHeaderSortDropdown/TableHeaderSortDropdown";
import { MetricProgress, MetricProgressCell } from "./MetricProgressCell";
import { TimeCell } from "./time_cell";
import { AGENT_CALL_TYPES, MCP_CALL_TYPES } from "./constants";
import { AgentBadge, LlmBadge, McpBadge } from "./TypeBadges";
import ProviderLogo from "../common_components/ProviderLogo";

/** API sort field mapping for /spend/logs/ui endpoint */
export const LOGS_SORT_FIELD_MAP = {
	startTime: "startTime",
	spend: "spend",
	total_tokens: "total_tokens",
	request_duration_ms: "request_duration_ms",
} as const;

export type LogsSortField = keyof typeof LOGS_SORT_FIELD_MAP;

/** 默认隐藏、可由用户勾选显示的列；id 与表格列 id 一一对应。 */
export type LogsOptionalColumnId =
	| "call_type"
	| "request_id"
	| "team_name"
	| "key_hash"
	| "user"
	| "end_user"
	| "request_tags";

/** Logs 设置中可勾选的列，顺序与表格列顺序一致。 */
export const LOGS_OPTIONAL_COLUMNS: readonly { id: LogsOptionalColumnId; label: string }[] = [
	{ id: "call_type", label: "Type" },
	{ id: "request_id", label: "Request ID" },
	{ id: "team_name", label: "Team Name" },
	{ id: "key_hash", label: "Key Hash" },
	{ id: "user", label: "Internal User" },
	{ id: "end_user", label: "End User" },
	{ id: "request_tags", label: "Tags" },
];

const OPTIONAL_COLUMN_IDS = new Set<string>(LOGS_OPTIONAL_COLUMNS.map((column) => column.id));

function columnOptionalId(column: ColumnDef<LogEntry>): LogsOptionalColumnId | undefined {
	const columnId =
		typeof column.id === "string"
			? column.id
			: "accessorKey" in column && typeof column.accessorKey === "string"
				? column.accessorKey
				: undefined;
	return columnId && OPTIONAL_COLUMN_IDS.has(columnId) ? (columnId as LogsOptionalColumnId) : undefined;
}

/**
 * 过滤默认隐藏的可选列（Internal User / End User / Tags 等）。
 * 未勾选的列不进入表格，避免横向拥挤；列自身定义保持不变。
 */
export function filterOptionalColumns(
	columns: ColumnDef<LogEntry>[],
	visibleOptionalColumns: readonly LogsOptionalColumnId[] = [],
): ColumnDef<LogEntry>[] {
	const visible = new Set<LogsOptionalColumnId>(visibleOptionalColumns);
	return columns.filter((column) => {
		const optionalId = columnOptionalId(column);
		return optionalId === undefined || visible.has(optionalId);
	});
}

const MIN_OUTPUT_TOKENS_FOR_TPS = 20;
const TPS_PROGRESS_MAX = 200;
const DURATION_PROGRESS_MAX_SECONDS = 30;
const TTFT_PROGRESS_MAX_SECONDS = 10;
const TOKEN_PROGRESS_MAX = {
	cacheRead: 600_000,
	input: 20_000,
	output: 2_000,
} as const;

interface TokenCostBreakdown {
	cacheInputCost?: number;
	inputCost?: number;
	outputCost?: number;
	model?: import("@/utils/priceDisplay").ModelPriceIdentity;
}

function readFiniteCost(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getTokenCostBreakdown(log: LogEntry): TokenCostBreakdown {
	const raw = log.metadata?.cost_breakdown;
	if (!raw || typeof raw !== "object") return {};

	const breakdown = raw as Record<string, unknown>;
	const inputCost = readFiniteCost(breakdown.input_cost);
	const outputCost = readFiniteCost(breakdown.output_cost);
	const totalCost = readFiniteCost(breakdown.total_cost);
	let cacheInputCost = readFiniteCost(breakdown.cache_input_cost);

	if (cacheInputCost === undefined) {
		const cacheReadCost = readFiniteCost(breakdown.cache_read_input_cost);
		const cacheCreationCost = readFiniteCost(breakdown.cache_creation_input_cost);
		if (cacheReadCost !== undefined || cacheCreationCost !== undefined) {
			cacheInputCost = (cacheReadCost ?? 0) + (cacheCreationCost ?? 0);
		}
	}

	const additionalCosts = breakdown.additional_costs;
	const hasNonTokenCosts =
		(readFiniteCost(breakdown.tool_usage_cost) ?? 0) !== 0 ||
		(additionalCosts !== null &&
			typeof additionalCosts === "object" &&
			Object.values(additionalCosts).some((value) => (readFiniteCost(value) ?? 0) !== 0)) ||
		[
			breakdown.discount_amount,
			breakdown.discount_percent,
			breakdown.margin_fixed_amount,
			breakdown.margin_percent,
			breakdown.margin_total_amount,
			breakdown.original_cost,
		].some((value) => (readFiniteCost(value) ?? 0) !== 0);

	if (
		cacheInputCost === undefined &&
		inputCost !== undefined &&
		outputCost !== undefined &&
		totalCost !== undefined &&
		!hasNonTokenCosts
	) {
		cacheInputCost = Math.max(0, totalCost - inputCost - outputCost);
	}

	return { cacheInputCost, inputCost, outputCost };
}

function CostBreakdownPopoverContent({
	cacheInputCost,
	inputCost,
	outputCost,
	model,
}: TokenCostBreakdown): React.ReactElement {
	const formatMoney = useMoneyFormatter();
	const fields = [
		{
			label: "缓存输入",
			value: formatMoney(cacheInputCost, 8, model),
			icon: <Database size={14} aria-hidden="true" />,
			className: "border-emerald-100 bg-emerald-50/70",
		},
		{
			label: "输入",
			value: formatMoney(inputCost, 8, model),
			icon: <ArrowDownToLine size={14} aria-hidden="true" />,
			className: "border-blue-100 bg-blue-50/70",
		},
		{
			label: "输出",
			value: formatMoney(outputCost, 8, model),
			icon: <ArrowUpFromLine size={14} aria-hidden="true" />,
			className: "border-violet-100 bg-violet-50/70",
		},
	];

	return (
		<div className="grid w-[390px] grid-cols-3 gap-2" aria-label="Cost breakdown">
			{fields.map((field) => (
				<div key={field.label} className={`rounded-lg border p-3 ${field.className}`}>
					<LabeledField label={field.label} value={field.value} icon={field.icon} />
				</div>
			))}
		</div>
	);
}

/** 路由弹层里的模型图标尺寸；图标只补充厂商信息，名称仍是主要内容。 */
const MODEL_INFO_ICON_CLASS = "mr-1 inline-block h-3.5 w-3.5 align-[-2px] object-contain";
const MODEL_INFO_ICON_FALLBACK_CLASS =
	"mr-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-200 align-[-2px] text-[10px] leading-none";

/**
 * 路由信息中的模型名。provider 取自当前日志，历史日志缺失 provider 时只显示名称，
 * 不为无法判断厂商的别名凭空画一个图标。
 */
function ModelNameWithIcon({ provider, model }: { provider?: string; model: string }): React.ReactElement {
	return (
		<>
			{provider ? (
				<ProviderLogo
					provider={provider}
					logo={getModelLogoAndName(provider, model).logo}
					className={MODEL_INFO_ICON_CLASS}
					fallbackClassName={MODEL_INFO_ICON_FALLBACK_CLASS}
				/>
			) : null}
			{model}
		</>
	);
}

/** 与 LabeledField 同一套排版，值可以是带图标的模型名。 */
function ModelInfoField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
	return (
		<div className="min-w-0">
			<div className="text-xs uppercase tracking-[0.05em] text-slate-500">{label}</div>
			<div className="min-w-0 break-all text-sm font-semibold text-slate-800">{children}</div>
		</div>
	);
}

function ModelInfoPopoverContent({
	provider,
	displayModelName,
	resolutionLines,
}: {
	provider?: string;
	displayModelName: string;
	resolutionLines: ModelResolutionLine[];
}): React.ReactElement {
	return (
		<div className="w-[440px] space-y-3" aria-label="Model information">
			<div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
				<ModelInfoField label="Provider">
					{provider ? (
						<>
							<ProviderLogo
								provider={provider}
								logo={getProviderLogoAndName(provider).logo}
								className={MODEL_INFO_ICON_CLASS}
								fallbackClassName={MODEL_INFO_ICON_FALLBACK_CLASS}
							/>
							{provider}
						</>
					) : (
						"-"
					)}
				</ModelInfoField>
				<ModelInfoField label="显示模型">
					{displayModelName ? <ModelNameWithIcon provider={provider} model={displayModelName} /> : "-"}
				</ModelInfoField>
			</div>
			{resolutionLines.length > 0 && (
				<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
					{resolutionLines.map((line, index) => (
						<Fragment key={`${line.label}-${index}`}>
							<span className="pt-0.5 text-xs uppercase tracking-[0.05em] text-slate-500">{line.label}</span>
							<div className="min-w-0 break-all text-sm font-semibold text-slate-800">
								{line.path.map((model, hopIndex) => (
									<Fragment key={`${model}-${hopIndex}`}>
										{hopIndex > 0 && " \u2192 "}
										<ModelNameWithIcon provider={provider} model={model} />
									</Fragment>
								))}
							</div>
						</Fragment>
					))}
				</div>
			)}
		</div>
	);
}

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
	return provider ? getModelLogoAndName(provider, row.model).logo : "";
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

export interface ModelResolutionLine {
	label: string;
	path: string[];
}

export function buildModelResolutionLines(
	fallbackModelsValue: unknown,
	resolutionChainValue: unknown,
	executedModel: string,
): ModelResolutionLine[] {
	const fallbackModels = Array.isArray(fallbackModelsValue)
		? fallbackModelsValue.filter((model): model is string => typeof model === "string" && model.length > 0)
		: [];
	const entries = normalizeModelResolutionChain(resolutionChainValue).sort(
		(left, right) => left.fallback_index - right.fallback_index,
	);
	const entriesByIndex = new Map(entries.map((entry) => [entry.fallback_index, entry]));
	const maxIndex = Math.max(fallbackModels.length - 1, ...entries.map((entry) => entry.fallback_index), 0);
	const lines: ModelResolutionLine[] = [];
	let previousModel: string | undefined;

	for (let index = 0; index <= maxIndex; index += 1) {
		const entry = entriesByIndex.get(index);
		const fallbackModel = fallbackModels[index];
		const path = entry?.resolution_path ?? (fallbackModel ? [fallbackModel] : []);
		if (path.length === 0) continue;
		const first = path[0]!;
		if (index === 0) {
			lines.push({ label: "Request", path: [first] });
		} else if (previousModel && previousModel !== first) {
			lines.push({ label: `Fallback ${index}`, path: [previousModel, first] });
		} else {
			lines.push({ label: `Fallback ${index}`, path: [first] });
		}
		for (let hop = 1; hop < path.length; hop += 1) {
			lines.push({ label: "Alias", path: [path[hop - 1], path[hop]] });
		}
		previousModel = path[path.length - 1];
	}

	if (executedModel) {
		lines.push({ label: "Executed", path: [executedModel] });
	}
	return lines;
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

function readNonNegativeTokenCount(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return Math.max(value, 0);
}

function getAdditionalUsage(metadata: LogEntry["metadata"]): Record<string, any> | undefined {
	const additionalUsage = metadata?.additional_usage_values;
	return additionalUsage && typeof additionalUsage === "object" ? additionalUsage : undefined;
}

/** Read cache tokens from both flattened LiteLLM fields and OpenAI detail objects. */
export function getCacheReadInputTokens(metadata: LogEntry["metadata"]): number {
	const additionalUsage = getAdditionalUsage(metadata);
	const usageObject =
		metadata?.usage_object && typeof metadata.usage_object === "object" ? metadata.usage_object : undefined;
	const candidates = [
		additionalUsage?.cache_read_input_tokens,
		additionalUsage?.prompt_tokens_details?.cached_tokens,
		additionalUsage?.input_tokens_details?.cached_tokens,
		usageObject?.cache_read_input_tokens,
		usageObject?.prompt_tokens_details?.cached_tokens,
		usageObject?.input_tokens_details?.cached_tokens,
	];
	for (const candidate of candidates) {
		const tokenCount = readNonNegativeTokenCount(candidate);
		if (tokenCount !== undefined) {
			return tokenCount;
		}
	}
	return 0;
}

/** Read cache-write tokens from both flattened LiteLLM fields and OpenAI detail objects. */
export function getCacheCreationInputTokens(metadata: LogEntry["metadata"]): number {
	const additionalUsage = getAdditionalUsage(metadata);
	const usageObject =
		metadata?.usage_object && typeof metadata.usage_object === "object" ? metadata.usage_object : undefined;
	const candidates = [
		additionalUsage?.cache_creation_input_tokens,
		additionalUsage?.prompt_tokens_details?.cache_creation_tokens,
		additionalUsage?.input_tokens_details?.cache_write_tokens,
		usageObject?.cache_creation_input_tokens,
		usageObject?.prompt_tokens_details?.cache_creation_tokens,
		usageObject?.input_tokens_details?.cache_write_tokens,
	];
	for (const candidate of candidates) {
		const tokenCount = readNonNegativeTokenCount(candidate);
		if (tokenCount !== undefined) {
			return tokenCount;
		}
	}
	return 0;
}

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

const buildColumns = (sortProps?: LogsSortProps): ColumnDef<LogEntry>[] => [
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
		size: 180,
		cell: (info: any) => <TimeCell utcTime={info.getValue()} />,
	},
	{
		// 会话类型徽标：LLM / Agent / MCP；多次调用的会话追加调用次数
		header: "Type",
		id: "call_type",
		cell: (info: any) => {
			const row = info.row.original as LogEntry;
			const sessionCount = row.session_total_count || 1;
			const count = sessionCount > 1 ? sessionCount : undefined;
			if (MCP_CALL_TYPES.includes(row.call_type)) return <McpBadge count={count} />;
			if (AGENT_CALL_TYPES.includes(row.call_type)) return <AgentBadge count={count} />;
			return <LlmBadge count={count} />;
		},
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
		header: "Request ID",
		accessorKey: "request_id",
		cell: (info: any) => {
			const requestId = String(info.getValue() || "-");
			return (
				<Tooltip title={requestId}>
					<span className="block max-w-[22ch] truncate font-mono text-xs">{requestId}</span>
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
		size: 190,
		cell: (info: any) => {
			const row = info.row.original as LogEntry;
			const mcpCount = row.mcp_tool_call_count || 0;
			const mcpSpend = row.mcp_tool_call_spend || 0;
			const tokenCosts = getTokenCostBreakdown(row);
			const spend = info.getValue() || 0;

			return (
				<div className="flex flex-col">
					<Popover
						content={<CostBreakdownPopoverContent {...tokenCosts} model={row} />}
						mouseEnterDelay={0.15}
						placement="bottomLeft"
						title={
							<div className="flex items-center justify-between gap-8 py-0.5">
								<span className="flex items-center gap-2 font-medium">
									<CircleDollarSign size={16} className="text-emerald-600" aria-hidden="true" />
									费用明细
								</span>
								<span className="font-mono text-xs font-semibold text-slate-600">
									{<Money value={spend || null} decimals={6} model={row} />}
								</span>
							</div>
						}
						trigger="hover"
					>
						<span className="inline-flex w-fit cursor-help items-center rounded-md px-1.5 py-0.5 font-mono tabular-nums transition-colors hover:bg-emerald-50 hover:text-emerald-700">
							{<Money value={spend || null} decimals={6} model={row} />}
						</span>
					</Popover>
					{mcpCount > 0 && mcpSpend > 0 && (
						<span className="text-[10px] text-amber-600">
							incl. {<Money value={mcpSpend || null} decimals={6} model={row} />} from {mcpCount} MCP
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
			const ttftSeconds = ttftMs / 1000;
			return (
				<MetricProgressCell
					ariaLabel={`TTFT ${ttftSeconds.toFixed(2)} seconds`}
					color="red"
					displayValue={ttftSeconds.toFixed(2)}
					maxValue={TTFT_PROGRESS_MAX_SECONDS}
					progressTestId="ttft-progress"
					tooltip={`${ttftMs}ms`}
					value={ttftSeconds}
				/>
			);
		},
	},
	{
		header: "Team Name",
		accessorKey: "metadata.user_api_key_team_alias",
		id: "team_name",
		cell: (info: any) => (
			<Tooltip title={String(info.getValue() || "-")}>
				<span className="block max-w-[25ch] truncate">{String(info.getValue() || "-")}</span>
			</Tooltip>
		),
	},
	{
		header: "Key Hash",
		accessorKey: "metadata.user_api_key",
		id: "key_hash",
		cell: (info: any) => {
			// 点击打开 key 详情页，与 Key Name 列保持同一交互
			const keyHash = String(info.getValue() || "-");
			const onKeyHashClick = sortProps?.onKeyHashClick ?? info.row.original.onKeyHashClick;
			return (
				<Tooltip title={keyHash}>
					<span
						className="block max-w-[25ch] cursor-pointer truncate font-mono text-xs hover:text-blue-600"
						onClick={() => keyHash !== "-" && onKeyHashClick?.(keyHash)}
					>
						{keyHash}
					</span>
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
		size: 280,
		cell: (info: any) => {
			const row = info.row.original as LogEntry;
			const provider = row.custom_llm_provider;
			const modelName = String(info.getValue() || "");
			const displayModelName = getDisplayModelName(modelName, provider);
			const builtinCapability =
				row.metadata?.internal_call_type === "builtin_capability"
					? String(row.metadata?.builtin_capability || "unknown")
					: null;
			const fallbackModels: string[] | undefined = row.metadata?.fallback_models;
			const fallbackCount = fallbackModels && fallbackModels.length > 1 ? fallbackModels.length - 1 : 0;
			const resolutionLines = buildModelResolutionLines(
				fallbackModels,
				row.metadata?.model_resolution_chain,
				modelName,
			);
			return (
				<div className="flex min-w-0 items-center gap-2">
					{provider && <ProviderLogo provider={provider} logo={getLogoUrl(row, provider)} />}
					{builtinCapability ? (
						<Tag color="purple" className="!m-0 shrink-0">
							Built-in · {builtinCapability}
						</Tag>
					) : null}
					<Popover
						content={
							<ModelInfoPopoverContent
								provider={provider}
								displayModelName={displayModelName}
								resolutionLines={resolutionLines}
							/>
						}
						mouseEnterDelay={0.15}
						placement="bottomLeft"
						title={
							<span className="flex items-center gap-2 py-0.5 font-medium">
								<GitBranch size={16} className="text-blue-600" aria-hidden="true" />
								模型路由信息
							</span>
						}
						trigger="hover"
					>
						<span className="flex min-w-0 cursor-help items-center rounded-md px-1.5 py-0.5 transition-colors hover:bg-blue-50">
							<span className="block max-w-[34ch] truncate font-medium text-slate-700">{displayModelName}</span>
							{fallbackCount > 0 && <span className="ml-1 shrink-0 text-xs text-slate-400">({fallbackCount})</span>}
						</span>
					</Popover>
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
		size: 320,
		cell: (info: any) => {
			const row = info.row.original;
			const rawCacheReadTokens = getCacheReadInputTokens(row.metadata);
			const rawCacheCreationTokens = getCacheCreationInputTokens(row.metadata);
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
						className="grid w-full grid-cols-3 whitespace-nowrap text-left font-mono tabular-nums text-sm text-current"
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
					maxValue={TPS_PROGRESS_MAX}
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

export interface LogsColumnOptions {
	/** 额外显示的可选列；未列出的可选列保持隐藏。 */
	visibleOptionalColumns?: readonly LogsOptionalColumnId[];
}

export const createColumns = (
	sortProps?: LogsSortProps,
	options: LogsColumnOptions = {},
): ColumnDef<LogEntry>[] => filterOptionalColumns(buildColumns(sortProps), options.visibleOptionalColumns);

/** Default columns without sort (for backward compatibility) */
export const columns = createColumns();
