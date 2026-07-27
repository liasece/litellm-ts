export interface UserInfo {
	user_id: string;
	user_email: string;
	user_alias: string | null;
	user_role: string;
	spend: number;
	max_budget: number | null;
	models: string[];
	key_count: number;
	created_at: string;
	updated_at: string;
	sso_user_id: string | null;
	budget_duration: string | null;
}

export interface UserFilterState {
	email: string;
	user_id: string;
	user_role: string;
	sso_user_id: string;
	team: string;
	model: string;
	min_spend: number | null;
	max_spend: number | null;
	sort_by: string;
	sort_order: "asc" | "desc";
}

export const initialUserFilters: UserFilterState = {
	email: "",
	user_id: "",
	user_role: "",
	sso_user_id: "",
	team: "",
	model: "",
	min_spend: null,
	max_spend: null,
	sort_by: "created_at",
	sort_order: "desc",
};

export interface TeamDisplayInfo {
	team_id: string;
	team_alias: string | null;
}

export interface TeamOption {
	team_id: string;
	team_alias: string;
}
