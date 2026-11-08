export type LogsSortField = "startTime" | "spend" | "total_tokens" | "request_duration_ms";
export type SessionGroupType = "session_id" | "claude_code_user_id";
export interface SessionGroupRef {
	type: SessionGroupType;
	id: string;
}
export interface LogEntry {
	request_id: string;
	api_key?: string | null;
	team_id?: string | null;
	model?: string | null;
	model_id?: string | null;
	api_base?: string | null;
	call_type?: string | null;
	spend?: number | null;
	total_tokens?: number | null;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	startTime: string;
	endTime?: string | null;
	user?: string | null;
	end_user?: string | null;
	custom_llm_provider?: string | null;
	metadata?: Record<string, unknown> | null;
	cache_hit?: string | boolean | null;
	cache_key?: string | null;
	request_tags?: unknown;
	requester_ip_address?: string | null;
	messages?: unknown;
	response?: unknown;
	proxy_server_request?: unknown;
	session_id?: string | null;
	session_group_type?: SessionGroupType | null;
	session_group_id?: string | null;
	status?: string | null;
	completionStartTime?: string | null;
	request_duration_ms?: number | null;
	session_total_count?: number | null;
	session_total_spend?: number | null;
	mcp_tool_call_count?: number | null;
	mcp_tool_call_spend?: number | null;
	[field: string]: unknown;
}
export interface LogsPage {
	data: LogEntry[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
	session_total_count?: number;
}
export interface SessionLogsPage extends LogsPage {
	snapshot?: string | null;
	next_cursor?: string | null;
}
export interface SessionLogsOptions {
	page?: number;
	pageSize?: number;
	teamId?: string;
	snapshot?: string | null;
	cursor?: string;
	knownTotal?: number;
	includeContent?: boolean;
	signal?: AbortSignal;
}
export type LogsOptionalColumnId = "call_type" | "request_id" | "team_name" | "key_hash" | "user" | "end_user" | "request_tags";
export const LOGS_OPTIONAL_COLUMNS: readonly { id: LogsOptionalColumnId; label: string }[] = [
	{ id: "call_type", label: "Type" },
	{ id: "request_id", label: "Request ID" },
	{ id: "team_name", label: "Team Name" },
	{ id: "key_hash", label: "Key Hash" },
	{ id: "user", label: "Internal User" },
	{ id: "end_user", label: "End User" },
	{ id: "request_tags", label: "Tags" },
];
