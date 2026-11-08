import type { LogEntry, LogsPage, SessionGroupRef } from "../support/LogsModels";

export function isInProgressLog(log: Pick<LogEntry, "status" | "metadata">): boolean {
	return log.status === "in_progress" || log.metadata?.status === "in_progress";
}
export function sessionGroupRef(log: Pick<LogEntry, "session_id" | "session_group_id" | "session_group_type">): SessionGroupRef | null {
	if ((log.session_group_type === "session_id" || log.session_group_type === "claude_code_user_id") && log.session_group_id) {
		return { type: log.session_group_type, id: log.session_group_id };
	}
	return log.session_id ? { type: "session_id", id: log.session_id } : null;
}
export function navigableSessionGroup(log: LogEntry): SessionGroupRef | null {
	return isInProgressLog(log) ? null : sessionGroupRef(log);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function shareEqualJson(previous: unknown, next: unknown): unknown {
	if (previous === next) return previous;
	if (Array.isArray(previous) && Array.isArray(next)) {
		let unchanged = previous.length === next.length;
		const shared = next.map((value, index) => {
			const result = shareEqualJson(previous[index], value);
			if (result !== previous[index]) unchanged = false;
			return result;
		});
		return unchanged ? previous : shared;
	}
	if (isRecord(previous) && isRecord(next)) {
		const keys = Object.keys(next);
		let unchanged = Object.keys(previous).length === keys.length;
		const result: Record<string, unknown> = Object.create(null);
		for (const key of keys) {
			result[key] = shareEqualJson(previous[key], next[key]);
			if (result[key] !== previous[key] || !Object.hasOwn(previous, key)) unchanged = false;
		}
		return unchanged ? previous : result;
	}
	return next;
}
export function shareLogRows(previous: LogsPage | undefined, next: LogsPage): LogsPage {
	if (!previous) return next;
	const byId = new Map(previous.data.map((entry) => [entry.request_id, entry]));
	const data = next.data.map((entry) => shareEqualJson(byId.get(entry.request_id), entry) as LogEntry);
	if (
		previous.data.length === data.length &&
		data.every((entry, index) => entry === previous.data[index]) &&
		previous.total === next.total &&
		previous.page === next.page &&
		previous.page_size === next.page_size &&
		previous.total_pages === next.total_pages &&
		previous.session_total_count === next.session_total_count
	)
		return previous;
	return { ...next, data };
}
