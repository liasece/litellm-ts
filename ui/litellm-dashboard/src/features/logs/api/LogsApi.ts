import { requestJson } from "../../platform/api/HttpApiClient";
import type { SessionGroupRef, SessionLogsOptions } from "../support/LogsModels";
import { parseLogDetail, parseLogDetailsBatch, parseLogsPage, parseSessionLogsPage } from "./LogsSchemas";

export const logsApi = {
	list: (params: URLSearchParams, signal?: AbortSignal) => requestJson("/spend/logs/ui?" + params.toString(), { signal }, parseLogsPage),
	// compact=true 让服务端只下发一份顶层 messages，其他副本留 "$messages" 标记；
	// 前端在展示层还原（见 LogDetailsDisplayLogic.resolveCompactAliases）。
	detail: (requestId: string, startDate: string, signal?: AbortSignal) =>
		requestJson(
			"/spend/logs/ui/" + encodeURIComponent(requestId) + "?start_date=" + encodeURIComponent(startDate) + "&compact=true",
			{ signal },
			parseLogDetail,
		),
	// 已结算详情不可变，前端缓存缺失的 request_id 时用批量接口一次补齐，避免逐条打开再请求。
	detailsBatch: (requests: readonly { request_id: string; start_date?: string; end_date?: string }[], signal?: AbortSignal) =>
		requestJson("/spend/logs/ui/batch", { method: "POST", body: JSON.stringify({ requests }), signal }, parseLogDetailsBatch),
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
