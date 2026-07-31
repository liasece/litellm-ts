import moment from "moment";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { uiSpendLogsCall } from "../networking";
import { Team } from "../key_team_helpers/key_list";
import { useQuery } from "@tanstack/react-query";
import { fetchAllTeams } from "../../components/key_team_helpers/filter_helpers";
import { debounce } from "lodash";
import { PaginatedResponse } from ".";
import type { LogsSortField } from "./columns";
import { DEFAULT_LOGS_PAGE_SIZE } from "./constants";
import { createEmptyLogFilters, FILTER_KEYS, hasBackendLogFilters, type LogFilterState } from "./log_filter_state";

export type { FilterKey, LogFilterState } from "./log_filter_state";

export function useLogFilterLogic({
	logs,
	accessToken,
	startTime, // Receive from SpendLogsTable
	endTime, // Receive from SpendLogsTable
	pageSize = DEFAULT_LOGS_PAGE_SIZE,
	isCustomDate,
	setCurrentPage,
	userID,
	userRole,
	sortBy = "startTime",
	sortOrder = "desc",
	currentPage = 1,
	initialFilters,
}: {
	logs: PaginatedResponse;
	accessToken: string | null;
	startTime: string;
	endTime: string;
	pageSize?: number;
	isCustomDate: boolean;
	setCurrentPage: (page: number) => void;
	userID: string | null;
	userRole: string | null;
	sortBy?: LogsSortField;
	sortOrder?: "asc" | "desc";
	currentPage?: number;
	initialFilters?: Partial<LogFilterState>;
}) {
	const defaultFilters = useMemo<LogFilterState>(() => createEmptyLogFilters(), []);

	const [filters, setFilters] = useState<LogFilterState>(() => ({
		...defaultFilters,
		...initialFilters,
	}));
	const [backendFilteredLogs, setBackendFilteredLogs] = useState<PaginatedResponse>({
		data: [],
		total: 0,
		page: 1,
		page_size: pageSize,
		total_pages: 0,
	});
	const lastSearchTimestamp = useRef(0);
	const performSearch = useCallback(
		async (filters: LogFilterState, page = 1) => {
			if (!accessToken) return;

			const currentTimestamp = Date.now();
			lastSearchTimestamp.current = currentTimestamp;

			const formattedStartTime = moment(startTime).utc().format("YYYY-MM-DD HH:mm:ss");
			const formattedEndTime = isCustomDate
				? moment(endTime).utc().format("YYYY-MM-DD HH:mm:ss")
				: moment().utc().format("YYYY-MM-DD HH:mm:ss");

			try {
				const response = await uiSpendLogsCall({
					accessToken,
					start_date: formattedStartTime,
					end_date: formattedEndTime,
					page,
					page_size: pageSize,
					params: {
						api_key: filters[FILTER_KEYS.KEY_HASH] || undefined,
						team_id: filters[FILTER_KEYS.TEAM_ID] || undefined,
						request_id: filters[FILTER_KEYS.REQUEST_ID] || undefined,
						user_id: filters[FILTER_KEYS.USER_ID] || undefined,
						end_user: filters[FILTER_KEYS.END_USER] || undefined,
						status_filter: filters[FILTER_KEYS.STATUS] || undefined,
						model_id: filters[FILTER_KEYS.MODEL] || undefined,
						key_alias: filters[FILTER_KEYS.KEY_ALIAS] || undefined,
						error_code: filters[FILTER_KEYS.ERROR_CODE] || undefined,
						error_message: filters[FILTER_KEYS.ERROR_MESSAGE] || undefined,
						sort_by: sortBy,
						sort_order: sortOrder,
						include_active: true,
					},
				});

				if (currentTimestamp === lastSearchTimestamp.current && response.data) {
					setBackendFilteredLogs(response);
				}
			} catch (error) {
				console.error("Error searching users:", error);
			}
		},
		[accessToken, startTime, endTime, isCustomDate, pageSize, sortBy, sortOrder],
	);

	const debouncedSearch = useMemo(
		() => debounce((filters: LogFilterState, page: number) => performSearch(filters, page), 300),
		[performSearch],
	);

	useEffect(() => {
		return () => debouncedSearch.cancel();
	}, [debouncedSearch]);

	// Determine when backend filters are active (server-side filtering)
	const hasBackendFilters = useMemo(() => hasBackendLogFilters(filters), [filters]);

	// Refetch when sort, page, or time range changes (backend filters use their own fetch, not the main query)
	useEffect(() => {
		if (hasBackendFilters && accessToken) {
			// Cancel any pending debounced search to prevent it from overwriting this page's results
			debouncedSearch.cancel();
			performSearch(filters, currentPage);
		}
		// Intentionally omitted from deps:
		// - `filters` / `debouncedSearch` / `performSearch`: filter changes are handled by
		//   handleFilterChange → debouncedSearch; adding them here would double-fetch on filter apply.
		// - `hasBackendFilters` / `accessToken`: stable across sort/page/time changes; including them
		//   would cause spurious re-runs when the filter state first becomes active.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sortBy, sortOrder, currentPage, startTime, endTime, isCustomDate]);

	// Compute client-side filtered logs directly from incoming logs and filters
	const clientDerivedFilteredLogs: PaginatedResponse = useMemo(() => {
		if (!logs || !logs.data) {
			return {
				data: [],
				total: 0,
				page: 1,
				page_size: pageSize,
				total_pages: 0,
			};
		}

		// If backend filters are on, don't perform client-side filtering here
		if (hasBackendFilters) {
			return logs;
		}

		let filteredData = [...logs.data];

		if (filters[FILTER_KEYS.TEAM_ID]) {
			filteredData = filteredData.filter((log) => log.team_id === filters[FILTER_KEYS.TEAM_ID]);
		}

		if (filters[FILTER_KEYS.STATUS]) {
			filteredData = filteredData.filter((log) => {
				if (filters[FILTER_KEYS.STATUS] === "success") {
					return !log.status || log.status === "success";
				}
				return log.status === filters[FILTER_KEYS.STATUS];
			});
		}

		if (filters[FILTER_KEYS.MODEL]) {
			filteredData = filteredData.filter((log) => log.model_id === filters[FILTER_KEYS.MODEL]);
		}

		if (filters[FILTER_KEYS.KEY_HASH]) {
			filteredData = filteredData.filter((log) => log.api_key === filters[FILTER_KEYS.KEY_HASH]);
		}

		if (filters[FILTER_KEYS.END_USER]) {
			filteredData = filteredData.filter((log) => log.end_user === filters[FILTER_KEYS.END_USER]);
		}

		if (filters[FILTER_KEYS.ERROR_CODE]) {
			filteredData = filteredData.filter((log) => {
				const metadata = log.metadata || {};
				const errorInfo = metadata.error_information;
				return errorInfo && errorInfo.error_code === filters[FILTER_KEYS.ERROR_CODE];
			});
		}

		return {
			data: filteredData,
			total: logs.total,
			page: logs.page,
			page_size: logs.page_size,
			total_pages: logs.total_pages,
		};
	}, [logs, filters, hasBackendFilters, pageSize]);

	// Choose which filtered logs to expose: backend result when active, otherwise client-derived
	const filteredLogs: PaginatedResponse = useMemo(() => {
		if (hasBackendFilters) {
			// Prefer backend result if present; otherwise fall back to latest logs
			if (backendFilteredLogs && backendFilteredLogs.data) {
				return backendFilteredLogs;
			}
			return (
				logs || {
					data: [],
					total: 0,
					page: 1,
					page_size: pageSize,
					total_pages: 0,
				}
			);
		}
		return clientDerivedFilteredLogs;
	}, [hasBackendFilters, backendFilteredLogs, clientDerivedFilteredLogs, logs, pageSize]);

	// Fetch all teams and users for potential filter dropdowns (optional, can be adapted)
	const { data: allTeams } = useQuery<Team[], Error>({
		queryKey: ["allTeamsForLogFilters", accessToken],
		queryFn: async () => {
			if (!accessToken) return [];
			// Use fetchAllTeams helper function for consistency and abstraction
			// Assuming fetchAllTeams returns Team[] directly
			const teamsData = await fetchAllTeams(accessToken);
			return teamsData || []; // Ensure it returns an array
		},
		enabled: !!accessToken,
	});

	// Update filters state
	const handleFilterChange = (newFilters: Partial<LogFilterState>) => {
		setFilters((prev) => {
			const updatedFilters = { ...prev, ...newFilters };

			// Ensure all keys in LogFilterState are present, defaulting to '' if not in newFilters
			for (const key of Object.keys(defaultFilters) as Array<keyof LogFilterState>) {
				if (!(key in updatedFilters)) {
					updatedFilters[key] = defaultFilters[key];
				}
			}

			// Only call debouncedSearch if filters have actually changed
			if (JSON.stringify(updatedFilters) !== JSON.stringify(prev)) {
				setCurrentPage(1);
				if (hasBackendLogFilters(updatedFilters)) {
					debouncedSearch(updatedFilters, 1);
				} else {
					debouncedSearch.cancel();
				}
			}

			return updatedFilters as LogFilterState;
		});
	};

	const handleFilterReset = () => {
		// Reset filters state
		setFilters(defaultFilters);

		// Clear backend filtered logs to ensure fresh render
		setBackendFilteredLogs({
			data: [],
			total: 0,
			page: 1,
			page_size: pageSize,
			total_pages: 0,
		});

		// The main query owns the unfiltered data source.
		debouncedSearch.cancel();
	};

	const refetchFilteredLogs = useCallback(async () => {
		debouncedSearch.cancel();
		await performSearch(filters, currentPage);
	}, [currentPage, debouncedSearch, filters, performSearch]);

	return {
		filters,
		filteredLogs,
		hasBackendFilters,
		allTeams,
		handleFilterChange,
		handleFilterReset,
		refetchFilteredLogs,
	};
}
