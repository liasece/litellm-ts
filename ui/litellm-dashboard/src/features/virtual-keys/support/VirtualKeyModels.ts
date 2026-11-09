import type { UiSelectOption } from "../../platform/ui/UiTypes";

export interface VirtualKey extends Record<string, unknown> {
	token: string;
	token_id?: string | null;
	key_name?: string | null;
	key_alias?: string | null;
	spend?: number | null;
	max_budget?: number | null;
	models: string[];
	metadata: Record<string, unknown>;
	object_permission?: Record<string, unknown> | null;
	team_id?: string | null;
	user_id?: string | null;
	organization_id?: string | null;
	org_id?: string | null;
	blocked?: boolean | null;
	expires?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	last_active?: string | null;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
	max_parallel_requests?: number | null;
	budget_duration?: string | null;
	budget_reset_at?: string | null;
	auto_rotate?: boolean;
	rotation_interval?: string | null;
	allowed_routes?: string[] | null;
	aliases?: Record<string, unknown> | null;
	user?: { user_id?: string; user_alias?: string | null; user_email?: string | null } | null;
	created_by_user?: { user_id?: string; user_alias?: string | null; user_email?: string | null } | null;
	created_by?: string | null;
	user_email?: string | null;
}
export interface KeyListResult {
	keys: VirtualKey[];
	total_count: number;
	current_page?: number;
	total_pages?: number;
}
export interface KeyFilters {
	team: string;
	organization: string;
	alias: string;
	user: string;
	hash: string;
}
export interface KeyQuery {
	page: number;
	size: number;
	sortBy: string;
	sortOrder: "asc" | "desc";
	filters: KeyFilters;
}
export interface KeyTeam extends Record<string, unknown> {
	team_id: string;
	team_alias?: string | null;
	organization_id?: string | null;
	models?: string[];
	max_budget?: number | null;
	budget_duration?: string | null;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
	members_with_roles?: { user_id: string; role: string }[];
}
export interface KeyOrganization extends Record<string, unknown> {
	organization_id: string;
	organization_alias?: string | null;
}
export interface KeyCatalog {
	teams: KeyTeam[];
	organizations: KeyOrganization[];
	models: string[];
	uiSettings: Record<string, unknown>;
	userRoles: Record<string, unknown>;
}
export interface KeyLoggingConfiguration extends Record<string, unknown> {
	callback_name: string;
}
export interface KeyDraft {
	presentFields: string[];
	omitTeamOnUpdate: boolean;
	owner: "you" | "another_user";
	user_id: string;
	agent_id: string;
	organization_id: string;
	team_id: string;
	key_alias: string;
	key: string;
	blocked: boolean;
	models: string[];
	key_type: string;
	allowed_routes: string;
	max_budget: number | null;
	budget_duration: string;
	tpm_limit: number | null;
	tpm_limit_type: string;
	rpm_limit: number | null;
	rpm_limit_type: string;
	max_parallel_requests: number | null;
	model_tpm_limit: string;
	model_rpm_limit: string;
	vector_stores: string[];
	allowed_agents: string[];
	agent_access_groups: string[];
	metadataText: string;
	logging: KeyLoggingConfiguration[];
	disabled_callbacks: string[];
	router_settings: Record<string, unknown>;
	aliases: Record<string, string>;
	duration: string;
	never_expire: boolean;
	auto_rotate: boolean;
	rotation_interval: string;
}
export function emptyKeyCatalog(): KeyCatalog {
	return {
		teams: [],
		organizations: [],
		models: [],
		uiSettings: {},
		userRoles: {},
	};
}
export function stringValues(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function selectedString(value: unknown): string {
	return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
export function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function selectOptions(values: readonly string[]): UiSelectOption[] {
	return values.map((value) => ({ value, label: value }));
}

export function markKeyField(draft: KeyDraft, name: string): void {
	if (!draft.presentFields.includes(name)) draft.presentFields.push(name);
}
