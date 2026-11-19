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
/**
 * 一页日志里同一个 request_id 只能出现一行，已结算的那一行优先。
 *
 * 服务端已经按 request_id 收敛过，这里仍再兜一层：行标识是虚拟表格的复用单位，
 * 一旦重复，两条不同位置的行会绑定同一个 key，渲染成内容完全一样的两行；而
 * “进行中的那一行”只是结算前的临时快照，遇到重复应让位给最终结果。
 * @param page - 接口返回的一页日志
 */
export function uniqueLogRows(page: LogsPage): LogsPage {
	if (page.data.length < 2) return page;
	const byId = new Map<string, number>();
	const data: LogEntry[] = [];
	let changed = false;
	for (const entry of page.data) {
		const index = entry.request_id ? byId.get(entry.request_id) : undefined;
		if (index === undefined) {
			if (entry.request_id) byId.set(entry.request_id, data.length);
			data.push(entry);
			continue;
		}
		changed = true;
		const kept = data[index];
		if (kept && isInProgressLog(kept) && !isInProgressLog(entry)) data[index] = entry;
	}
	return changed ? { ...page, data } : page;
}
export function shareLogRows(previous: LogsPage | undefined, next: LogsPage): LogsPage {
	const nextRows = uniqueLogRows(next);
	if (!previous) return nextRows;
	const base = uniqueLogRows(previous);
	const byId = new Map(base.data.map((entry) => [entry.request_id, entry]));
	const data = nextRows.data.map((entry) => shareEqualJson(byId.get(entry.request_id), entry) as LogEntry);
	if (
		base.data.length === data.length &&
		data.every((entry, index) => entry === base.data[index]) &&
		base.total === next.total &&
		base.page === next.page &&
		base.page_size === next.page_size &&
		base.total_pages === next.total_pages &&
		base.session_total_count === next.session_total_count
	)
		return base;
	return { ...nextRows, data };
}
