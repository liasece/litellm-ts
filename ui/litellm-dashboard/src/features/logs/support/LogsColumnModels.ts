import type { LogsOptionalColumnId, LogsSortField } from "./LogsModels";
export interface LogsColumn {
	id: string;
	label: string;
	width: number;
	sort?: LogsSortField;
	optional?: LogsOptionalColumnId;
}
const columns: readonly LogsColumn[] = [
	{ id: "startTime", label: "Time", width: 180, sort: "startTime" },
	{ id: "call_type", label: "Type", width: 150, optional: "call_type" },
	{ id: "status", label: "Status", width: 150 },
	{ id: "session_id", label: "Session ID", width: 150 },
	{ id: "request_id", label: "Request ID", width: 150 },
	{ id: "spend", label: "Cost", width: 190, sort: "spend" },
	{ id: "request_duration_ms", label: "Duration (s)", width: 150, sort: "request_duration_ms" },
	{ id: "completionStartTime", label: "TTFT (s)", width: 150 },
	{ id: "team_name", label: "Team Name", width: 150, optional: "team_name" },
	{ id: "key_hash", label: "Key Hash", width: 150, optional: "key_hash" },
	{ id: "key_name", label: "Key Name", width: 150 },
	{ id: "model", label: "Model", width: 280 },
	{ id: "total_tokens", label: "Tokens", width: 320, sort: "total_tokens" },
	{ id: "output_tps", label: "输出 TPS", width: 150 },
	{ id: "user", label: "Internal User", width: 150, optional: "user" },
	{ id: "end_user", label: "End User", width: 150, optional: "end_user" },
	{ id: "request_tags", label: "Tags", width: 150, optional: "request_tags" },
];
export function logsColumns(visible: readonly LogsOptionalColumnId[] = []): LogsColumn[] {
	return columns.filter((column) => !column.optional || visible.includes(column.optional));
}
