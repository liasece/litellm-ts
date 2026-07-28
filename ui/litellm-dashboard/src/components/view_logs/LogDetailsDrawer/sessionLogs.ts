import { sessionSpendLogsCall } from "../../networking";
import type { LogEntry, SessionGroupRef } from "../columns";

export const SESSION_LOG_PAGE_SIZE = 100;
const MAX_SESSION_LOG_PAGES = 1000;

interface LoadCompleteSessionLogsOptions {
	accessToken: string;
	sessionGroup: SessionGroupRef;
	teamId?: string;
	includeContent?: boolean;
}

/**
 * Load one stable, complete session snapshot. The trace sidebar and the
 * simulation drawer share this path so their pagination semantics stay equal.
 */
export async function loadCompleteSessionLogs({
	accessToken,
	sessionGroup,
	teamId,
	includeContent = false,
}: LoadCompleteSessionLogsOptions): Promise<LogEntry[]> {
	const contentOptions = includeContent ? { includeContent: true } : {};
	const firstPage = await sessionSpendLogsCall(accessToken, sessionGroup, {
		pageSize: SESSION_LOG_PAGE_SIZE,
		teamId,
		...contentOptions,
	});
	const allSessionLogs: LogEntry[] = [...(firstPage.data || firstPage || [])];
	const expectedTotal =
		!Array.isArray(firstPage) && Number.isSafeInteger(firstPage.total) && Number(firstPage.total) >= 0
			? Number(firstPage.total)
			: null;

	if (!Array.isArray(firstPage) && firstPage.next_cursor) {
		let snapshot = typeof firstPage.snapshot === "string" && firstPage.snapshot ? firstPage.snapshot : undefined;
		let cursor = firstPage.next_cursor;
		if (!snapshot) throw new Error("Session logs response contains invalid snapshot");
		for (let pageCount = 1; cursor; pageCount += 1) {
			if (pageCount >= MAX_SESSION_LOG_PAGES) {
				throw new Error("Session logs response exceeds pagination limit");
			}
			const response = await sessionSpendLogsCall(accessToken, sessionGroup, {
				pageSize: SESSION_LOG_PAGE_SIZE,
				teamId,
				...contentOptions,
				snapshot,
				cursor,
				...(expectedTotal !== null ? { knownTotal: expectedTotal } : {}),
			});
			allSessionLogs.push(...(response.data || response || []));
			snapshot = typeof response.snapshot === "string" && response.snapshot ? response.snapshot : snapshot;
			cursor = typeof response.next_cursor === "string" ? response.next_cursor : "";
		}
	} else if (!Array.isArray(firstPage)) {
		const totalPages = firstPage.total_pages ?? 1;
		if (
			!Number.isSafeInteger(totalPages) ||
			totalPages < (allSessionLogs.length > 0 ? 1 : 0) ||
			totalPages > MAX_SESSION_LOG_PAGES
		) {
			throw new Error("Session logs response contains invalid total_pages");
		}
		for (let page = 2; page <= totalPages; page += 1) {
			const response = await sessionSpendLogsCall(accessToken, sessionGroup, {
				page,
				pageSize: SESSION_LOG_PAGE_SIZE,
				teamId,
				...contentOptions,
			});
			allSessionLogs.push(...(response.data || response || []));
		}
	}

	const uniqueSessionLogs = Array.from(new Map(allSessionLogs.map((row) => [row.request_id, row])).values());
	if (expectedTotal !== null && uniqueSessionLogs.length !== expectedTotal) {
		throw new Error(`Session logs incomplete: loaded ${uniqueSessionLogs.length} of ${expectedTotal}`);
	}

	return uniqueSessionLogs
		.map((row) => ({
			...row,
			request_duration_ms: row.request_duration_ms ?? Date.parse(row.endTime) - Date.parse(row.startTime),
		}))
		.sort((a, b) => {
			const timeDifference = new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
			return timeDifference !== 0 ? timeDifference : b.request_id.localeCompare(a.request_id);
		});
}
