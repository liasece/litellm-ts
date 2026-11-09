export type AccessRecord = Record<string, unknown>;
export interface AccessMember extends AccessRecord {
	user_id?: string | null;
	user_email?: string | null;
	role: string;
	user_role?: string;
	spend?: number;
	created_at?: string;
	max_budget_in_team?: number | null;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
}
export interface AccessBudget extends AccessRecord {
	budget_id: string;
	max_budget?: number | string | null;
	soft_budget?: number | null;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
	budget_duration?: string | null;
	updated_at?: string;
}
export interface ObjectPermission extends AccessRecord {
	mcp_servers?: string[];
	mcp_access_groups?: string[];
	mcp_tool_permissions?: Record<string, string[]>;
	vector_stores?: string[];
	agents?: string[];
	agent_access_groups?: string[];
}
export interface AccessTeam extends AccessRecord {
	team_id: string;
	team_alias?: string | null;
	organization_id?: string | null;
	models: string[];
	max_budget?: number | null;
	soft_budget?: number | null;
	budget_duration?: string | null;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
	spend?: number;
	created_at?: string;
	members_with_roles: AccessMember[];
	keys: AccessRecord[];
	metadata?: AccessRecord | null;
	object_permission?: ObjectPermission | null;
	policies?: string[];
	access_group_ids?: string[];
	blocked?: boolean;
}
export interface TeamDetail extends AccessRecord {
	team_id: string;
	team_info: AccessTeam;
	keys: AccessRecord[];
	team_memberships: AccessRecord[];
}
export interface AccessOrganization extends AccessRecord {
	organization_id: string;
	organization_alias: string;
	models: string[];
	spend?: number;
	members: AccessMember[];
	teams?: AccessTeam[];
	metadata?: AccessRecord | null;
	object_permission?: ObjectPermission | null;
	litellm_budget_table: AccessBudget;
	created_at?: string;
}
export interface AccessUser extends AccessRecord {
	user_id: string;
	user_email?: string | null;
	user_alias?: string | null;
	user_role?: string;
	spend?: number;
	max_budget?: number | null;
	models: string[];
	key_count?: number;
	created_at?: string | null;
	updated_at?: string | null;
	sso_user_id?: string | null;
	budget_duration?: string | null;
	metadata?: AccessRecord | null;
	teams?: string[];
}
export interface PageResult<T> {
	rows: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}
export interface ResourceOption {
	value: string;
	label: string;
	description?: string;
}
export interface AccessCatalog {
	models: ResourceOption[];
	teams: AccessTeam[];
	organizations: AccessOrganization[];
	roles: Record<string, { ui_label: string; description?: string }>;
	errors: string[];
}
export function emptyAccessCatalog(): AccessCatalog {
	return {
		models: [],
		teams: [],
		organizations: [],
		roles: {},
		errors: [],
	};
}
export type AccessKind = "team" | "organization" | "user" | "budget";
export interface ResourceDraft extends AccessRecord {
	team_alias?: string;
	organization_alias?: string;
	user_email?: string;
	user_alias?: string;
	user_role?: string;
	team_id?: string;
	organization_id?: string | null;
	models?: string[];
	max_budget?: number | null;
	budget_duration?: string | null;
	metadata?: string;
}
