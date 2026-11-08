import type { LogEntry } from "../support/LogsModels";
import { assertLogDetailEntry } from "../data/LogDetailsPayloadData";
export type LogDetailsPayload = Record<string, unknown> | null;
export const LOG_DETAILS_POLL_INTERVAL_MS = 2000;
export function isLogEntryInProgress(row: LogEntry | null | undefined): boolean {
	return row?.status === "in_progress" || row?.metadata?.status === "in_progress";
}
export function shouldPollLogDetails(payload: LogDetailsPayload | undefined, streaming: boolean, listRowInProgress: boolean): boolean {
	if (streaming) return false;
	if (payload?.status === "in_progress") return true;
	return listRowInProgress && payload == null;
}
export function isDetailInProgress(row: LogEntry | null, payload: LogDetailsPayload | undefined): boolean {
	const detailInProgress = payload?.status === "in_progress";
	const detailSettled = payload != null && !detailInProgress;
	return !detailSettled && (isLogEntryInProgress(row) || detailInProgress);
}
export function mergeLogDetails(row: LogEntry | null, payload: LogDetailsPayload | undefined): LogEntry | null {
	if (!row) return null;
	const active = isDetailInProgress(row, payload);
	const extras = active && payload ? payload : {};
	const result = {
		...row,
		...extras,
		request_id: row.request_id,
		messages: payload?.messages || row.messages,
		response: payload?.response || row.response,
		proxy_server_request: payload?.proxy_server_request || row.proxy_server_request,
	};
	assertLogDetailEntry(result);
	return result;
}
