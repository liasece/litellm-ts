export interface Project {
	id: string;
	name: string;
	description: string;
	teamId: string;
	teamAlias: string;
	models: string[];
	status: "active" | "blocked";
	spend: number;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	updatedBy: string;
}

export interface ProjectTeamInfo {
	team_id: string;
	team_alias?: string;
	models?: string[];
	max_budget?: number | null;
	budget_duration?: string | null;
	spend?: number;
	members_with_roles?: { user_id: string; role: string }[];
}
