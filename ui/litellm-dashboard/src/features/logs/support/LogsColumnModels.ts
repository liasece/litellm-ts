import type { LogsOptionalColumnId, LogsSortField } from "./LogsModels";
export interface LogsColumn {
	id: string;
	label: string;
	/** 列的最小宽度；容器还有余量时由弹性列平均分配，不再强制固定列宽。 */
	minWidth: number;
	/** 内容宽度稳定的列使用固定宽度，不参与剩余空间分配。 */
	fixedWidth?: number;
	sort?: LogsSortField;
	optional?: LogsOptionalColumnId;
}
const columns: readonly LogsColumn[] = [
	{ id: "startTime", label: "Time", minWidth: 174, fixedWidth: 174, sort: "startTime" },
	{ id: "call_type", label: "Type", minWidth: 105, optional: "call_type" },
	{ id: "status", label: "Status", minWidth: 112, fixedWidth: 112 },
	{ id: "session_id", label: "Session ID", minWidth: 112, fixedWidth: 112 },
	{ id: "request_id", label: "Request ID", minWidth: 120, fixedWidth: 120 },
	{ id: "spend", label: "Cost", minWidth: 118, sort: "spend" },
	{ id: "request_duration_ms", label: "Duration (s)", minWidth: 112, sort: "request_duration_ms" },
	{ id: "completionStartTime", label: "TTFT (s)", minWidth: 84 },
	{ id: "team_name", label: "Team Name", minWidth: 105, optional: "team_name" },
	{ id: "key_hash", label: "Key Hash", minWidth: 105, optional: "key_hash" },
	{ id: "key_name", label: "Key Name", minWidth: 80 },
	{ id: "model", label: "Model", minWidth: 174 },
	// 本请求被哪些路由能力处理过；常驻列，不做可选项：它是排查路由问题的第一列。
	{ id: "features", label: "Feature", minWidth: 86 },
	{ id: "total_tokens", label: "Tokens", minWidth: 225, sort: "total_tokens" },
	{ id: "tps", label: "TPS", minWidth: 155 },
	{ id: "user", label: "Internal User", minWidth: 105, optional: "user" },
	{ id: "end_user", label: "End User", minWidth: 105, optional: "end_user" },
	{ id: "request_tags", label: "Tags", minWidth: 115, optional: "request_tags" },
];
export function logsColumns(visible: readonly LogsOptionalColumnId[] = []): LogsColumn[] {
	return columns.filter((column) => !column.optional || visible.includes(column.optional));
}
