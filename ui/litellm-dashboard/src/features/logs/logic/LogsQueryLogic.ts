import { isAllTimeInterval } from "../support/LogsConstants";
import type { LogFilterState } from "./LogsFilterLogic";
import { utcApiDate } from "./LogsDateLogic";
import type { LogsUrlState } from "./LogsUrlLogic";

const filterParams: Readonly<Record<keyof LogFilterState, string>> = {
	"Team ID": "team_id",
	"Key Hash": "api_key",
	"Request ID": "request_id",
	"Session ID": "session_id",
	Model: "model_id",
	"User ID": "user_id",
	"End User": "end_user",
	Status: "status_filter",
	"Key Alias": "key_alias",
	"Error Code": "error_code",
	"Error Message": "error_message",
};
/**
 * 构造日志列表查询参数。
 *
 * All Time 档位不传 start_date，服务端因此不加时间谓词（列表仍是时间倒序，第一页代价很低）。
 * 预设区间（Last 15 Minutes…Last 7 Days）的终点恒为「现在」，而协议里的日期只有整秒，
 * 由客户端填 end_date 必然把当前这一秒的毫秒部分排除，刚注册的在途行就查不到。
 * 因此预设区间不传 end_date，让服务端按自己的 now 补齐；只有自定义区间才发送精确终点。
 * @param state - 列表状态（时间范围、分页、排序、过滤）
 * @param scope - 当前用户与角色，用于内部用户的 user_id 收敛
 */
export function logsQuery(state: LogsUrlState, scope: { userId: string; role: string }): URLSearchParams {
	const params = new URLSearchParams({
		page: String(state.currentPage),
		page_size: String(state.pageSize),
		sort_by: state.sortBy,
		sort_order: state.sortOrder,
		include_active: "true",
	});
	if (state.isCustomDate) {
		params.set("start_date", utcApiDate(state.startTime));
		params.set("end_date", utcApiDate(state.endTime));
	} else if (!isAllTimeInterval(state.selectedTimeInterval)) {
		params.set("start_date", utcApiDate(state.startTime));
	}
	for (const [key, param] of Object.entries(filterParams)) {
		const value = state.filters[key as keyof LogFilterState];
		if (value) params.set(param, value);
	}
	if (["Internal User", "Internal Viewer"].includes(scope.role) && !params.has("user_id")) params.set("user_id", scope.userId);
	return params;
}
