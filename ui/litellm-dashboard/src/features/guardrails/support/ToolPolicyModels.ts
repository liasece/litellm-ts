export interface ToolPolicyRow extends Record<string, unknown> {
	tool_id: string;
	tool_name: string;
	origin?: string | null;
	input_policy: string;
	output_policy: string;
	call_count?: number | null;
	assignments?: Record<string, unknown> | null;
	key_hash?: string | null;
	team_id?: string | null;
	key_alias?: string | null;
	created_at?: string;
	updated_at?: string;
	created_by?: string;
	updated_by?: string;
	user_agent?: string | null;
	last_used_at?: string | null;
}
export interface ToolPolicyOverride extends Record<string, unknown> {
	override_id: string;
	tool_name: string;
	team_id?: string | null;
	key_hash?: string | null;
	input_policy: string;
	key_alias?: string | null;
	created_at?: string;
	updated_at?: string;
}
export interface ToolPolicyDetail {
	tool: ToolPolicyRow;
	overrides: ToolPolicyOverride[];
}
export interface ToolUsageLog {
	id: string;
	timestamp: string;
	model?: string | null;
	spend?: number | null;
	total_tokens?: number | null;
	input_snippet?: string | null;
}
export interface ToolKeyChoice {
	token: string;
	key_alias?: string | null;
}
export interface ToolPolicyChoice {
	value: string;
	label: string;
	description: string;
}
export interface ToolPolicyScope {
	team_id?: string | null;
	key_hash?: string | null;
	key_alias?: string | null;
}
export type ToolPolicySortField = "tool_name" | "input_policy" | "output_policy" | "team_id" | "key_alias" | "created_at" | "call_count";
