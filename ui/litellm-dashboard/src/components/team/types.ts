import type { Member } from "../networking";

export interface TeamMembership {
	user_id: string;
	team_id: string;
	budget_id: string;
	spend: number;
	litellm_budget_table: {
		budget_id: string;
		soft_budget: number | null;
		max_budget: number | null;
		max_parallel_requests: number | null;
		tpm_limit: number | null;
		rpm_limit: number | null;
		model_max_budget: Record<string, number> | null;
		budget_duration: string | null;
	};
}

export interface TeamData {
	team_id: string;
	team_info: {
		team_alias: string;
		team_id: string;
		organization_id: string | null;
		admins: string[];
		members: string[];
		members_with_roles: Member[];
		metadata: Record<string, any>;
		tpm_limit: number | null;
		rpm_limit: number | null;
		max_budget: number | null;
		soft_budget?: number | null;
		budget_duration: string | null;
		models: string[];
		blocked: boolean;
		spend: number;
		max_parallel_requests: number | null;
		budget_reset_at: string | null;
		model_id: string | null;
		litellm_model_table: {
			model_aliases: Record<string, string>;
		} | null;
		created_at: string;
		access_group_ids?: string[];
		guardrails?: string[];
		policies?: string[];
		object_permission?: {
			object_permission_id: string;
			mcp_servers: string[];
			mcp_access_groups?: string[];
			mcp_tool_permissions?: Record<string, string[]>;
			vector_stores: string[];
			agents?: string[];
			agent_access_groups?: string[];
		};
		team_member_budget_table: {
			max_budget: number;
			budget_duration: string;
			tpm_limit: number | null;
			rpm_limit: number | null;
		} | null;
	};
	keys: any[];
	team_memberships: TeamMembership[];
}
