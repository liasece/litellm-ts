export const FILTER_KEYS = {
	TEAM_ID: "Team ID",
	KEY_HASH: "Key Hash",
	REQUEST_ID: "Request ID",
	MODEL: "Model",
	USER_ID: "User ID",
	END_USER: "End User",
	STATUS: "Status",
	KEY_ALIAS: "Key Alias",
	ERROR_CODE: "Error Code",
	ERROR_MESSAGE: "Error Message",
} as const;

export type FilterKey = keyof typeof FILTER_KEYS;
export type LogFilterState = Record<(typeof FILTER_KEYS)[FilterKey], string>;

export function createEmptyLogFilters(): LogFilterState {
	return {
		[FILTER_KEYS.TEAM_ID]: "",
		[FILTER_KEYS.KEY_HASH]: "",
		[FILTER_KEYS.REQUEST_ID]: "",
		[FILTER_KEYS.MODEL]: "",
		[FILTER_KEYS.USER_ID]: "",
		[FILTER_KEYS.END_USER]: "",
		[FILTER_KEYS.STATUS]: "",
		[FILTER_KEYS.KEY_ALIAS]: "",
		[FILTER_KEYS.ERROR_CODE]: "",
		[FILTER_KEYS.ERROR_MESSAGE]: "",
	};
}

export function hasBackendLogFilters(filters: LogFilterState): boolean {
	return !!(
		filters[FILTER_KEYS.KEY_ALIAS] ||
		filters[FILTER_KEYS.KEY_HASH] ||
		filters[FILTER_KEYS.REQUEST_ID] ||
		filters[FILTER_KEYS.USER_ID] ||
		filters[FILTER_KEYS.END_USER] ||
		filters[FILTER_KEYS.ERROR_CODE] ||
		filters[FILTER_KEYS.ERROR_MESSAGE] ||
		filters[FILTER_KEYS.MODEL]
	);
}
