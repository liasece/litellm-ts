export interface ShellSettings {
	enable_projects_ui?: boolean;
	enabled_ui_pages_internal_users?: string[] | null;
	disable_agents_for_internal_users?: boolean;
	allow_agents_for_team_admins?: boolean;
	disable_vector_stores_for_internal_users?: boolean;
	allow_vector_stores_for_team_admins?: boolean;
}
export interface Membership {
	user_id: string;
	user_role?: string;
	role?: string;
}
export interface ShellOrganization {
	organization_id: string;
	organization_alias?: string | null;
	members?: Membership[];
}
export interface ShellTeam {
	team_id: string;
	team_alias?: string | null;
	members_with_roles?: Membership[];
}
export interface ShellTheme {
	logo_url?: string | null;
	favicon_url?: string | null;
}
export interface LicenseUsage {
	total_users: number | null;
	total_users_used: number;
	total_users_remaining: number | null;
	total_teams: number | null;
	total_teams_used: number;
	total_teams_remaining: number | null;
}
