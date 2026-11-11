import { isLocalDateTime, subtractInterval } from "./LogsDateLogic";
import type { LogsSortField } from "../support/LogsModels";
import {
	ALL_TIME_INTERVAL,
	DEFAULT_LOGS_PAGE_SIZE,
	isAllTimeInterval,
	LOGS_PAGE_SIZE_OPTIONS,
	QUICK_SELECT_OPTIONS,
} from "../support/LogsConstants";
import { createEmptyLogFilters, FILTER_KEYS, type LogFilterState } from "./LogsFilterLogic";

const FILTER_URL_PARAMS: Record<keyof LogFilterState, string> = {
	[FILTER_KEYS.TEAM_ID]: "team_id",
	[FILTER_KEYS.KEY_HASH]: "api_key",
	[FILTER_KEYS.REQUEST_ID]: "request_id",
	[FILTER_KEYS.SESSION_ID]: "session_id",
	[FILTER_KEYS.MODEL]: "model_id",
	[FILTER_KEYS.USER_ID]: "user_id",
	[FILTER_KEYS.END_USER]: "end_user",
	[FILTER_KEYS.STATUS]: "status_filter",
	[FILTER_KEYS.KEY_ALIAS]: "key_alias",
	[FILTER_KEYS.ERROR_CODE]: "error_code",
	[FILTER_KEYS.ERROR_MESSAGE]: "error_message",
};

const VALID_SORT_FIELDS: LogsSortField[] = ["startTime", "spend", "total_tokens", "request_duration_ms"];

export interface LogsUrlState {
	filters: LogFilterState;
	currentPage: number;
	pageSize: number;
	startTime: string;
	endTime: string;
	isCustomDate: boolean;
	selectedTimeInterval: {
		value: number;
		unit: string;
	};
	sortBy: LogsSortField;
	sortOrder: "asc" | "desc";
}

export interface LogsUrlDefaults {
	startTime: string;
	endTime: string;
}

function readPositiveInteger(value: string | null, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidDateTime(value: string | null): value is string {
	return isLocalDateTime(value);
}

export function readLogsUrlState(search: string, defaults: LogsUrlDefaults): LogsUrlState {
	const params = new URLSearchParams(search);
	const filters = createEmptyLogFilters();

	for (const filterName of Object.keys(FILTER_URL_PARAMS) as Array<keyof LogFilterState>) {
		filters[filterName] = params.get(FILTER_URL_PARAMS[filterName]) ?? "";
	}

	// 旧版工具栏的 Request ID 搜索迁移为表头筛选，保证历史链接仍指向同一条请求。
	const legacySearch = (params.get("logs_search") ?? "").trim();
	if (!filters[FILTER_KEYS.REQUEST_ID] && legacySearch) filters[FILTER_KEYS.REQUEST_ID] = legacySearch;

	const requestedPageSize = readPositiveInteger(params.get("logs_page_size"), DEFAULT_LOGS_PAGE_SIZE);
	const pageSize = LOGS_PAGE_SIZE_OPTIONS.includes(requestedPageSize as (typeof LOGS_PAGE_SIZE_OPTIONS)[number])
		? requestedPageSize
		: DEFAULT_LOGS_PAGE_SIZE;

	const requestedSortBy = params.get("logs_sort_by");
	const sortBy = VALID_SORT_FIELDS.includes(requestedSortBy as LogsSortField) ? (requestedSortBy as LogsSortField) : "startTime";
	const sortOrder = params.get("logs_sort_order") === "asc" ? "asc" : "desc";

	// 时间范围的默认档位是 All Time：不带 logs_time_* 参数即不过滤时间。
	const requestedIntervalUnit = params.get("logs_time_unit") ?? ALL_TIME_INTERVAL.unit;
	const requestedIntervalValue =
		requestedIntervalUnit === ALL_TIME_INTERVAL.unit ? ALL_TIME_INTERVAL.value : readPositiveInteger(params.get("logs_time_value"), 24);
	const selectedTimeInterval = QUICK_SELECT_OPTIONS.find(
		(option) => option.value === requestedIntervalValue && option.unit === requestedIntervalUnit,
	) ?? { value: ALL_TIME_INTERVAL.value, unit: ALL_TIME_INTERVAL.unit };

	const requestedStartTime = params.get("logs_start");
	const requestedEndTime = params.get("logs_end");
	const isCustomDate = params.get("logs_custom_date") === "1" && isValidDateTime(requestedStartTime) && isValidDateTime(requestedEndTime);
	// All Time 不参与区间换算：startTime 仅作为自定义输入的默认值与详情回查提示保留。
	const isDefaultInterval = isAllTimeInterval(selectedTimeInterval);

	return {
		filters,
		currentPage: readPositiveInteger(params.get("logs_page"), 1),
		pageSize,
		startTime: isCustomDate
			? requestedStartTime
			: isDefaultInterval
				? defaults.startTime
				: subtractInterval(selectedTimeInterval.value, selectedTimeInterval.unit),
		endTime: isCustomDate ? requestedEndTime : defaults.endTime,
		isCustomDate,
		selectedTimeInterval: {
			value: selectedTimeInterval.value,
			unit: selectedTimeInterval.unit,
		},
		sortBy,
		sortOrder,
	};
}

function setOptionalParam(params: URLSearchParams, name: string, value: string, include: boolean) {
	if (include) {
		params.set(name, value);
	} else {
		params.delete(name);
	}
}

export function writeLogsUrlState(params: URLSearchParams, state: LogsUrlState): URLSearchParams {
	// Logs owns only its route marker and the parameters serialized below.
	// Rebuild from an allowlist so stale state from another page (for example
	// `tab=aliases`) cannot survive a Logs render and later leak through nav.
	const next = new URLSearchParams();
	if (params.get("page") === "logs") {
		next.set("page", "logs");
	}

	for (const filterName of Object.keys(FILTER_URL_PARAMS) as Array<keyof LogFilterState>) {
		const value = state.filters[filterName] ?? "";
		setOptionalParam(next, FILTER_URL_PARAMS[filterName], value, value !== "");
	}

	setOptionalParam(next, "logs_page", String(state.currentPage), state.currentPage !== 1);
	setOptionalParam(next, "logs_page_size", String(state.pageSize), state.pageSize !== DEFAULT_LOGS_PAGE_SIZE);
	setOptionalParam(next, "logs_sort_by", state.sortBy, state.sortBy !== "startTime");
	setOptionalParam(next, "logs_sort_order", state.sortOrder, state.sortOrder !== "desc");
	setOptionalParam(next, "logs_custom_date", "1", state.isCustomDate);
	setOptionalParam(next, "logs_start", state.startTime, state.isCustomDate);
	setOptionalParam(next, "logs_end", state.endTime, state.isCustomDate);

	const isDefaultInterval = isAllTimeInterval(state.selectedTimeInterval);
	setOptionalParam(next, "logs_time_value", String(state.selectedTimeInterval.value), !state.isCustomDate && !isDefaultInterval);
	setOptionalParam(next, "logs_time_unit", state.selectedTimeInterval.unit, !state.isCustomDate && !isDefaultInterval);

	return next;
}
