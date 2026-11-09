export interface DeletedKeyFilters extends Record<string, string> {
	key_hash: string;
	key_alias: string;
	team_id: string;
	user_id: string;
}

export function createEmptyDeletedKeyFilters(): DeletedKeyFilters {
	return { key_hash: "", key_alias: "", team_id: "", user_id: "" };
}
