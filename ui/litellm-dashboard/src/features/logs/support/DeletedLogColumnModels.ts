export interface DeletedLogColumn {
	key: string;
	label: string;
	width: number;
	maxWidth: number;
	kind?: "date" | "money" | "key-budget" | "team-budget" | "models";
	mono?: boolean;
	blue?: boolean;
}
export const deletedKeyColumns: readonly DeletedLogColumn[] = [
	{ key: "token", label: "Key ID", width: 150, maxWidth: 250, mono: true, blue: true },
	{ key: "key_alias", label: "Key Alias", width: 150, maxWidth: 200, mono: true },
	{ key: "team_alias", label: "Team Alias", width: 120, maxWidth: 180 },
	{ key: "spend", label: "Spend", width: 100, maxWidth: 140, kind: "money" },
	{ key: "max_budget", label: "Budget", width: 110, maxWidth: 150, kind: "key-budget" },
	{ key: "user_email", label: "User Email", width: 160, maxWidth: 250, mono: true },
	{ key: "user_id", label: "User ID", width: 120, maxWidth: 200 },
	{ key: "created_at", label: "Created At", width: 120, maxWidth: 140, kind: "date" },
	{ key: "created_by", label: "Created By", width: 120, maxWidth: 180 },
	{ key: "deleted_at", label: "Deleted At", width: 120, maxWidth: 140, kind: "date" },
	{ key: "deleted_by", label: "Deleted By", width: 120, maxWidth: 180 },
];
export const deletedTeamColumns: readonly DeletedLogColumn[] = [
	{ key: "team_alias", label: "Team Name", width: 150, maxWidth: 200 },
	{ key: "team_id", label: "Team ID", width: 150, maxWidth: 250, mono: true, blue: true },
	{ key: "created_at", label: "Created", width: 120, maxWidth: 140, kind: "date" },
	{ key: "spend", label: "Spend", width: 100, maxWidth: 140, kind: "money" },
	{ key: "max_budget", label: "Budget", width: 110, maxWidth: 150, kind: "team-budget" },
	{ key: "models", label: "Models", width: 200, maxWidth: 300, kind: "models" },
	{ key: "organization_id", label: "Organization", width: 150, maxWidth: 200 },
	{ key: "deleted_at", label: "Deleted At", width: 120, maxWidth: 140, kind: "date" },
	{ key: "deleted_by", label: "Deleted By", width: 120, maxWidth: 180 },
];
