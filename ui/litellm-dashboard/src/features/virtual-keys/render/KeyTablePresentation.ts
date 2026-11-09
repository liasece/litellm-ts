import type { VirtualKey } from "../support/VirtualKeyModels";

export interface KeyColumn {
	key: string;
	label: string;
	width: number;
	sortable?: boolean;
	tooltip?: string;
}
export const keyColumns: readonly KeyColumn[] = [
	{ key: "token", label: "Key ID", width: 100, sortable: true },
	{ key: "key_alias", label: "Key Alias", width: 150, sortable: true },
	{ key: "enabled", label: "Enabled", width: 110 },
	{ key: "key_name", label: "Secret Key", width: 120 },
	{ key: "team_alias", label: "Team", width: 120 },
	{ key: "organization_alias", label: "Organization", width: 160 },
	{ key: "user", label: "User", width: 160, tooltip: "Displays the first available value: User Alias, User Email, or User ID." },
	{ key: "created_at", label: "Created At", width: 120, sortable: true },
	{ key: "created_by", label: "Created By", width: 160 },
	{ key: "updated_at", label: "Updated At", width: 120, sortable: true },
	{
		key: "last_active",
		label: "Last Active",
		width: 130,
		tooltip: "This is a new field and is not backfilled. Only new key usage will update this value.",
	},
	{ key: "expires", label: "Expires", width: 120 },
	{ key: "spend", label: "Spend", width: 120, sortable: true },
	{ key: "max_budget", label: "Budget", width: 110, sortable: true },
	{ key: "budget_reset_at", label: "Budget Reset", width: 130 },
	{ key: "models", label: "Models", width: 200 },
	{ key: "rate_limits", label: "Rate Limits", width: 140 },
];
export function keyDate(value: unknown, missing: string): string {
	return typeof value === "string" && value ? new Date(value).toLocaleDateString() : missing;
}
export function keyTimestamp(value: unknown): string {
	if (!(typeof value === "string" || value instanceof Date) || !value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return (
		date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
		" at " +
		date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
	);
}
export function ownerName(key: VirtualKey, creator = false): string {
	const user = creator ? key.created_by_user : key.user;
	return user?.user_alias || user?.user_email || (creator ? key.created_by : key.user_email || key.user_id) || "-";
}
