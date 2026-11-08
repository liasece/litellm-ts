import { z } from "zod";
import type { LogEntry, LogsPage, SessionLogsPage } from "../support/LogsModels";

const text = z.string().nullable().optional();
const number = z.number().finite().nullable().optional();
export const logEntrySchema = z
	.object({
		request_id: z.string(),
		startTime: z.string(),
		endTime: text,
		api_key: text,
		team_id: text,
		model: text,
		model_id: text,
		api_base: text,
		call_type: text,
		spend: number,
		total_tokens: number,
		prompt_tokens: number,
		completion_tokens: number,
		user: text,
		end_user: text,
		custom_llm_provider: text,
		metadata: z.record(z.string(), z.unknown()).nullable().optional(),
		cache_hit: z.union([z.string(), z.boolean()]).nullable().optional(),
		cache_key: text,
		request_tags: z.unknown().optional(),
		requester_ip_address: text,
		messages: z.unknown().optional(),
		response: z.unknown().optional(),
		proxy_server_request: z.unknown().optional(),
		session_id: text,
		session_group_type: z.enum(["session_id", "claude_code_user_id"]).nullable().optional(),
		session_group_id: text,
		status: text,
		completionStartTime: text,
		request_duration_ms: number,
		session_total_count: number,
		session_total_spend: number,
		mcp_tool_call_count: number,
		mcp_tool_call_spend: number,
	})
	.passthrough();
export const logsPageSchema = z
	.object({
		data: z.array(logEntrySchema),
		total: z.number().int().nonnegative(),
		page: z.number().int().positive(),
		page_size: z.number().int().positive(),
		total_pages: z.number().int().nonnegative(),
		session_total_count: z.number().int().nonnegative().optional(),
	})
	.passthrough();
export function parseLogEntry(payload: unknown): LogEntry {
	return logEntrySchema.parse(payload);
}
export function parseLogsPage(payload: unknown): LogsPage {
	return logsPageSchema.parse(payload);
}
export function parseSessionLogsPage(payload: unknown): SessionLogsPage | LogEntry[] {
	if (Array.isArray(payload)) return z.array(logEntrySchema).parse(payload);
	return logsPageSchema
		.extend({ snapshot: z.string().nullable().optional(), next_cursor: z.string().nullable().optional() })
		.parse(payload);
}
export function parseLogDetail(payload: unknown): Record<string, unknown> | null {
	return payload === null ? null : z.record(z.string(), z.unknown()).parse(payload);
}
