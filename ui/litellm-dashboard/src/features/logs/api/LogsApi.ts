import { requestJson } from "../../platform/api/HttpApiClient";
import type { SessionGroupRef, SessionLogsOptions } from "../support/LogsModels";
import { parseLogDetail, parseLogsPage, parseSessionLogsPage } from "./LogsSchemas";

export const logsApi = {
	list: (params: URLSearchParams, signal?: AbortSignal) => requestJson("/spend/logs/ui?" + params.toString(), { signal }, parseLogsPage),
	detail: (requestId: string, startDate: string, signal?: AbortSignal) =>
		requestJson(
			"/spend/logs/ui/" + encodeURIComponent(requestId) + "?start_date=" + encodeURIComponent(startDate),
			{ signal },
			parseLogDetail,
		),
	session: (group: SessionGroupRef, options: SessionLogsOptions = {}) => {
		const params = new URLSearchParams({ session_group_type: group.type, session_group_id: group.id });
		if (options.page !== undefined) params.set("page", String(options.page));
		if (options.pageSize !== undefined) params.set("page_size", String(options.pageSize));
		if (options.teamId) params.set("team_id", options.teamId);
		if (options.snapshot) params.set("snapshot", options.snapshot);
		if (options.cursor) params.set("cursor", options.cursor);
		if (options.knownTotal !== undefined) params.set("known_total", String(options.knownTotal));
		if (options.includeContent) params.set("include_content", "true");
		return requestJson(
			"/spend/logs/session/ui?" + params.toString().replace(/\+/g, "%20"),
			{ signal: options.signal },
			parseSessionLogsPage,
		);
	},
};
export type LogsApi = typeof logsApi;
