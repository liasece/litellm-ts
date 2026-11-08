import type { AuditLogEntry } from "../api/AuxiliaryLogsApi";
export const AUDIT_TABLE_NAMES: Readonly<Record<string, string>> = {
	LiteLLM_VerificationToken: "Keys",
	LiteLLM_TeamTable: "Teams",
	LiteLLM_UserTable: "Users",
	LiteLLM_OrganizationTable: "Organizations",
	LiteLLM_ProxyModelTable: "Models",
};
export const AUDIT_ACTION_COLORS: Readonly<Record<string, string>> = {
	created: "green",
	updated: "blue",
	deleted: "red",
	rotated: "orange",
};
export function auditTimestamp(value: string): string {
	const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z");
	if (!Number.isFinite(date.getTime())) return "Invalid date";
	const month = date.toLocaleString("en-US", { month: "short" });
	const pad = (v: number) => String(v).padStart(2, "0");
	return (
		month +
		" " +
		date.getDate() +
		", " +
		date.getFullYear() +
		" " +
		pad(date.getHours()) +
		":" +
		pad(date.getMinutes()) +
		":" +
		pad(date.getSeconds())
	);
}
export function auditDiff(log: AuditLogEntry): {
	before: Record<string, unknown> | null | undefined;
	after: Record<string, unknown> | null | undefined;
} {
	const before = log.before_value,
		after = log.updated_values;
	if (!["updated", "rotated"].includes(log.action) || !before || !after) return { before, after };
	const changedBefore: Record<string, unknown> = Object.create(null),
		changedAfter: Record<string, unknown> = Object.create(null);
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
			if (Object.hasOwn(before, key)) changedBefore[key] = before[key];
			if (Object.hasOwn(after, key)) changedAfter[key] = after[key];
		}
	}
	for (const key of Object.keys(before))
		if (!Object.hasOwn(after, key) && !Object.hasOwn(changedBefore, key)) {
			changedBefore[key] = before[key];
			changedAfter[key] = undefined;
		}
	for (const key of Object.keys(after))
		if (!Object.hasOwn(before, key) && !Object.hasOwn(changedAfter, key)) {
			changedAfter[key] = after[key];
			changedBefore[key] = undefined;
		}
	return {
		before: Object.keys(changedBefore).length ? changedBefore : { note: "No differing fields detected" },
		after: Object.keys(changedAfter).length ? changedAfter : { note: "No differing fields detected" },
	};
}
