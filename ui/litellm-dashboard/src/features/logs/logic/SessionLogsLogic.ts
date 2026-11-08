import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import { logsApi, type LogsApi } from "../api/LogsApi";

export async function loadCompleteSessionLogs(
	group: SessionGroupRef,
	options: { teamId?: string; includeContent?: boolean; signal?: AbortSignal } = {},
	api: Pick<LogsApi, "session"> = logsApi,
): Promise<LogEntry[]> {
	const pageOptions = { pageSize: 100, ...options };
	const first = await api.session(group, pageOptions);
	const rows: LogEntry[] = [...(Array.isArray(first) ? first : first.data)];
	const expectedTotal = !Array.isArray(first) ? first.total : null;
	if (!Array.isArray(first) && first.next_cursor) {
		let snapshot = first.snapshot;
		let cursor = first.next_cursor;
		if (!snapshot) throw new Error("Session logs response contains invalid snapshot");
		for (let pageCount = 1; cursor; pageCount++) {
			if (pageCount >= 1000) throw new Error("Session logs response exceeds pagination limit");
			const page = await api.session(group, {
				...pageOptions,
				snapshot,
				cursor,
				...(expectedTotal !== null ? { knownTotal: expectedTotal } : {}),
			});
			rows.push(...(Array.isArray(page) ? page : page.data));
			if (Array.isArray(page)) {
				cursor = "";
				continue;
			}
			if (page.snapshot) snapshot = page.snapshot;
			cursor = page.next_cursor ?? "";
		}
	} else if (!Array.isArray(first)) {
		if (!Number.isSafeInteger(first.total_pages) || first.total_pages < (rows.length ? 1 : 0) || first.total_pages > 1000) {
			throw new Error("Session logs response contains invalid total_pages");
		}
		for (let number = 2; number <= first.total_pages; number++) {
			const page = await api.session(group, { ...pageOptions, page: number });
			rows.push(...(Array.isArray(page) ? page : page.data));
		}
	}
	const unique = [...new Map(rows.map((row) => [row.request_id, row])).values()];
	if (expectedTotal !== null && unique.length !== expectedTotal) {
		throw new Error("Session logs incomplete: loaded " + unique.length + " of " + expectedTotal);
	}
	return unique
		.map((row) => ({
			...row,
			request_duration_ms: row.request_duration_ms ?? Date.parse(row.endTime ?? "") - Date.parse(row.startTime),
		}))
		.sort((a, b) => {
			const delta = Date.parse(b.startTime) - Date.parse(a.startTime);
			return delta !== 0 ? delta : b.request_id.localeCompare(a.request_id);
		});
}
