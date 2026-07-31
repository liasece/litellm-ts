import moment from "moment";
import type { LogsSortField } from "./columns";
import { DEFAULT_LOGS_PAGE_SIZE, LOGS_PAGE_SIZE_OPTIONS, QUICK_SELECT_OPTIONS } from "./constants";
import { createEmptyLogFilters, FILTER_KEYS, type LogFilterState } from "./log_filter_state";

const FILTER_URL_PARAMS: Record<keyof LogFilterState, string> = {
	[FILTER_KEYS.TEAM_ID]: "team_id",
	[FILTER_KEYS.KEY_HASH]: "api_key",
	[FILTER_KEYS.REQUEST_ID]: "request_id",
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
	searchTerm: string;
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
	return !!value && moment(value, "YYYY-MM-DDTHH:mm", true).isValid();
}

export function readLogsUrlState(search: string, defaults: LogsUrlDefaults): LogsUrlState {
	const params = new URLSearchParams(search);
	const filters = createEmptyLogFilters();

	for (const filterName of Object.keys(FILTER_URL_PARAMS) as Array<keyof LogFilterState>) {
		filters[filterName] = params.get(FILTER_URL_PARAMS[filterName]) ?? "";
	}

	const requestedPageSize = readPositiveInteger(params.get("logs_page_size"), DEFAULT_LOGS_PAGE_SIZE);
	const pageSize = LOGS_PAGE_SIZE_OPTIONS.includes(requestedPageSize as (typeof LOGS_PAGE_SIZE_OPTIONS)[number])
		? requestedPageSize
		: DEFAULT_LOGS_PAGE_SIZE;

	const requestedSortBy = params.get("logs_sort_by");
	const sortBy = VALID_SORT_FIELDS.includes(requestedSortBy as LogsSortField)
		? (requestedSortBy as LogsSortField)
		: "startTime";
	const sortOrder = params.get("logs_sort_order") === "asc" ? "asc" : "desc";

	const requestedIntervalValue = readPositiveInteger(params.get("logs_time_value"), 24);
	const requestedIntervalUnit = params.get("logs_time_unit") ?? "hours";
	const selectedTimeInterval =
		QUICK_SELECT_OPTIONS.find(
			(option) => option.value === requestedIntervalValue && option.unit === requestedIntervalUnit,
		) ?? QUICK_SELECT_OPTIONS.find((option) => option.value === 24 && option.unit === "hours")!;

	const requestedStartTime = params.get("logs_start");
	const requestedEndTime = params.get("logs_end");
	const isCustomDate =
		params.get("logs_custom_date") === "1" && isValidDateTime(requestedStartTime) && isValidDateTime(requestedEndTime);
	const isDefaultInterval = selectedTimeInterval.value === 24 && selectedTimeInterval.unit === "hours";

	return {
		filters,
		searchTerm: params.get("logs_search") ?? "",
		currentPage: readPositiveInteger(params.get("logs_page"), 1),
		pageSize,
		startTime: isCustomDate
			? requestedStartTime
			: isDefaultInterval
				? defaults.startTime
				: moment()
						.subtract(selectedTimeInterval.value, selectedTimeInterval.unit as moment.unitOfTime.DurationConstructor)
						.format("YYYY-MM-DDTHH:mm"),
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
	const next = new URLSearchParams(params);

	for (const filterName of Object.keys(FILTER_URL_PARAMS) as Array<keyof LogFilterState>) {
		const value = state.filters[filterName];
		setOptionalParam(next, FILTER_URL_PARAMS[filterName], value, value !== "");
	}

	setOptionalParam(next, "logs_search", state.searchTerm, state.searchTerm !== "");
	setOptionalParam(next, "logs_page", String(state.currentPage), state.currentPage !== 1);
	setOptionalParam(next, "logs_page_size", String(state.pageSize), state.pageSize !== DEFAULT_LOGS_PAGE_SIZE);
	setOptionalParam(next, "logs_sort_by", state.sortBy, state.sortBy !== "startTime");
	setOptionalParam(next, "logs_sort_order", state.sortOrder, state.sortOrder !== "desc");
	setOptionalParam(next, "logs_custom_date", "1", state.isCustomDate);
	setOptionalParam(next, "logs_start", state.startTime, state.isCustomDate);
	setOptionalParam(next, "logs_end", state.endTime, state.isCustomDate);

	const isDefaultInterval = state.selectedTimeInterval.value === 24 && state.selectedTimeInterval.unit === "hours";
	setOptionalParam(
		next,
		"logs_time_value",
		String(state.selectedTimeInterval.value),
		!state.isCustomDate && !isDefaultInterval,
	);
	setOptionalParam(next, "logs_time_unit", state.selectedTimeInterval.unit, !state.isCustomDate && !isDefaultInterval);

	return next;
}
