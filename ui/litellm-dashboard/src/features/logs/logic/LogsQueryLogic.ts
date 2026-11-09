import type { LogFilterState } from "./LogsFilterLogic";
import { utcApiDate } from "./LogsDateLogic";
import type { LogsUrlState } from "./LogsUrlLogic";

const filterParams: Readonly<Record<keyof LogFilterState, string>> = {
	"Team ID": "team_id",
	"Key Hash": "api_key",
	"Request ID": "request_id",
	Model: "model_id",
	"User ID": "user_id",
	"End User": "end_user",
	Status: "status_filter",
	"Key Alias": "key_alias",
	"Error Code": "error_code",
	"Error Message": "error_message",
};
export function logsQuery(state: LogsUrlState, scope: { userId: string; role: string }, now: Date = new Date()): URLSearchParams {
	const params = new URLSearchParams({
		start_date: utcApiDate(state.startTime),
		end_date: utcApiDate(state.isCustomDate ? state.endTime : now),
		page: String(state.currentPage),
		page_size: String(state.pageSize),
		sort_by: state.sortBy,
		sort_order: state.sortOrder,
		include_active: "true",
	});
	for (const [key, param] of Object.entries(filterParams)) {
		const value = state.filters[key as keyof LogFilterState];
		if (value) params.set(param, value);
	}
	if (["Internal User", "Internal Viewer"].includes(scope.role) && !params.has("user_id")) params.set("user_id", scope.userId);
	return params;
}
