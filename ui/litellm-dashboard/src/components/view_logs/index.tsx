import { keepPreviousData, useQuery } from "@tanstack/react-query";
import moment from "moment";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { Button } from "antd";
import { internalUserRoles } from "../../utils/roles";
import DeletedKeysPage from "../DeletedKeysPage/DeletedKeysPage";
import DeletedTeamsPage from "../DeletedTeamsPage/DeletedTeamsPage";
import { KeyResponse, Team } from "../key_team_helpers/key_list";
import { PaginatedKeyAliasSelect } from "../KeyAliasSelect/PaginatedKeyAliasSelect/PaginatedKeyAliasSelect";
import { PaginatedModelSelect } from "../ModelSelect/PaginatedModelSelect/PaginatedModelSelect";
import FilterComponent, { FilterOption } from "../molecules/filter";
import { allEndUsersCall, keyInfoV1Call, uiSpendLogsCall } from "../networking";
import KeyInfoView from "../templates/key_info_view";
import AuditLogs from "./audit_logs";
import { createColumns, getSessionGroupRef, LogEntry, type LogsSortField, type SessionGroupRef } from "./columns";
import {
	DEFAULT_LIVE_TAIL_INTERVAL_MS,
	DEFAULT_LOGS_PAGE_SIZE,
	ERROR_CODE_OPTIONS,
	isLiveTailIntervalMs,
	type LiveTailIntervalMs,
} from "./constants";
import { useLogFilterLogic } from "./log_filter_logic";
import LiveTailBanner from "./LiveTailBanner";
import { LogDetailsDrawer, SessionSimulationDrawer } from "./LogDetailsDrawer";
import LogsPagination from "./LogsPagination";
import LogsToolbar from "./LogsToolbar";
import SpendLogsSettingsModal from "./SpendLogsSettingsModal/SpendLogsSettingsModal";
import { DataTable } from "./table";

interface SpendLogsTableProps {
	accessToken: string | null;
	token: string | null;
	userRole: string | null;
	userID: string | null;
	allTeams: Team[];
	premiumUser: boolean;
}

export interface PaginatedResponse {
	data: LogEntry[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

export default function SpendLogsTable({
	accessToken,
	token,
	userRole,
	userID,
	allTeams,
	premiumUser,
}: SpendLogsTableProps) {
	const [searchTerm, setSearchTerm] = useState("");
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState<number>(DEFAULT_LOGS_PAGE_SIZE);

	// New state variables for Start and End Time
	const [startTime, setStartTime] = useState<string>(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
	const [endTime, setEndTime] = useState<string>(moment().format("YYYY-MM-DDTHH:mm"));

	const [isCustomDate, setIsCustomDate] = useState(false);
	const [selectedTeamId, setSelectedTeamId] = useState("");
	const [selectedKeyHash, setSelectedKeyHash] = useState("");
	const [selectedModelId, setSelectedModelId] = useState("");
	const [selectedKeyInfo, setSelectedKeyInfo] = useState<KeyResponse | null>(null);
	const [selectedKeyIdInfoView, setSelectedKeyIdInfoView] = useState<string | null>(null);
	const [selectedStatus, setSelectedStatus] = useState("");
	const [selectedEndUser, setSelectedEndUser] = useState("");
	const [filterByCurrentUser, setFilterByCurrentUser] = useState(userRole && internalUserRoles.includes(userRole));
	const [activeTab, setActiveTab] = useState("request logs");

	const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [selectedSessionGroup, setSelectedSessionGroup] = useState<SessionGroupRef | null>(null);
	const [simulationSessionGroup, setSimulationSessionGroup] = useState<SessionGroupRef | null>(null);
	const [isSpendLogsSettingsModalVisible, setIsSpendLogsSettingsModalVisible] = useState(false);

	const [sortBy, setSortBy] = useState<LogsSortField>("startTime");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
	const [isManualRefreshing, setIsManualRefreshing] = useState(false);

	// Tracks whether any filter that uses performSearch (backend) is active.
	// Used to disable the main query so it doesn't fire redundant unfiltered requests
	// when time range / sort / page changes while a backend filter is in effect.
	const [isMainQueryEnabled, setIsMainQueryEnabled] = useState(true);

	const [liveTailIntervalMs, setLiveTailIntervalMs] = useState<LiveTailIntervalMs>(() => {
		const storedInterval = sessionStorage.getItem("liveTailIntervalMs");
		if (storedInterval !== null) {
			const parsedInterval = Number(storedInterval);
			if (isLiveTailIntervalMs(parsedInterval)) {
				return parsedInterval;
			}
		}

		const legacyLiveTail = sessionStorage.getItem("isLiveTail");
		if (legacyLiveTail !== null) {
			try {
				return JSON.parse(legacyLiveTail) === false ? 0 : DEFAULT_LIVE_TAIL_INTERVAL_MS;
			} catch {
				// Ignore malformed legacy state and use the new default.
			}
		}
		return DEFAULT_LIVE_TAIL_INTERVAL_MS;
	});

	useEffect(() => {
		sessionStorage.setItem("liveTailIntervalMs", String(liveTailIntervalMs));
		sessionStorage.removeItem("isLiveTail");
	}, [liveTailIntervalMs]);

	const [selectedTimeInterval, setSelectedTimeInterval] = useState<{ value: number; unit: string }>({
		value: 24,
		unit: "hours",
	});

	useEffect(() => {
		const fetchKeyInfo = async () => {
			if (selectedKeyIdInfoView && accessToken) {
				const keyData = await keyInfoV1Call(accessToken, selectedKeyIdInfoView);

				const keyResponse: KeyResponse = {
					...keyData["info"],
					token: selectedKeyIdInfoView,
					api_key: selectedKeyIdInfoView,
				};
				setSelectedKeyInfo(keyResponse);
			}
		};
		fetchKeyInfo();
	}, [selectedKeyIdInfoView, accessToken]);

	useEffect(() => {
		if (userRole && internalUserRoles.includes(userRole)) {
			// The asynchronously loaded role establishes the initial scope for internal users.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setFilterByCurrentUser(true);
		}
	}, [userRole]);

	const logs = useQuery<PaginatedResponse>({
		queryKey: [
			"logs",
			"table",
			currentPage,
			pageSize,
			startTime,
			endTime,
			selectedTeamId,
			selectedKeyHash,
			filterByCurrentUser ? userID : null,
			selectedStatus,
			selectedModelId,
			sortBy,
			sortOrder,
		],
		queryFn: async () => {
			if (!accessToken || !token || !userRole || !userID) {
				return {
					data: [],
					total: 0,
					page: 1,
					page_size: pageSize,
					total_pages: 0,
				};
			}

			const formattedStartTime = moment(startTime).utc().format("YYYY-MM-DD HH:mm:ss");
			const formattedEndTime = isCustomDate
				? moment(endTime).utc().format("YYYY-MM-DD HH:mm:ss")
				: moment().utc().format("YYYY-MM-DD HH:mm:ss");

			// Get base response from API
			// NOTE: We only fetch the list of logs here (lightweight).
			// Log details (messages/response) are fetched on-demand when user clicks a row.
			const response = await uiSpendLogsCall({
				accessToken,
				start_date: formattedStartTime,
				end_date: formattedEndTime,
				page: currentPage,
				page_size: pageSize,
				params: {
					api_key: selectedKeyHash || undefined,
					team_id: selectedTeamId || undefined,
					user_id: filterByCurrentUser ? userID ?? undefined : undefined,
					end_user: selectedEndUser || undefined,
					status_filter: selectedStatus || undefined,
					model_id: selectedModelId || undefined,
					sort_by: sortBy,
					sort_order: sortOrder,
					include_active: true,
				},
			});

			return response;
		},
		enabled: !!accessToken && !!token && !!userRole && !!userID && activeTab === "request logs" && isMainQueryEnabled,
		refetchInterval: liveTailIntervalMs > 0 && currentPage === 1 ? liveTailIntervalMs : false,
		placeholderData: keepPreviousData,
		refetchIntervalInBackground: false,
		structuralSharing: true,
		// Polling transport state must not invalidate the whole Logs view.
		// React Query's structural sharing preserves unchanged row references in `data`.
		notifyOnChangeProps: ["data", "isLoading"],
	});

	const logsData = logs.data || {
		data: [],
		total: 0,
		page: 1,
		page_size: pageSize,
		total_pages: 1,
	};

	const {
		filters,
		filteredLogs,
		hasBackendFilters,
		handleFilterChange,
		handleFilterReset: handleFilterResetFromHook,
	} = useLogFilterLogic({
		logs: logsData,
		accessToken,
		startTime,
		endTime,
		pageSize,
		isCustomDate,
		setCurrentPage,
		userID,
		userRole,
		sortBy,
		sortOrder,
		currentPage,
	});

	const handleFilterReset = useCallback(() => {
		handleFilterResetFromHook();
		// Reset custom time range to default (last 24 hours)
		setStartTime(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
		setEndTime(moment().format("YYYY-MM-DDTHH:mm"));
		setIsCustomDate(false);
		setSelectedTimeInterval({ value: 24, unit: "hours" });
		setCurrentPage(1);
	}, [handleFilterResetFromHook]);

	// Disable the main query whenever backend filters are active so it doesn't fire
	// redundant unfiltered requests when time range / sort / page changes.
	useEffect(() => {
		// The filtered-query lifecycle gates the otherwise redundant unfiltered query.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setIsMainQueryEnabled(!hasBackendFilters);
	}, [hasBackendFilters]);

	// Sync filter state into the individual selectedX state variables used by the main query
	useEffect(() => {
		if (!accessToken) return;

		/* eslint-disable react-hooks/set-state-in-effect -- Applied filters intentionally synchronize the query parameter state. */
		if (filters["Team ID"]) {
			setSelectedTeamId(filters["Team ID"]);
		} else {
			setSelectedTeamId("");
		}
		setSelectedStatus(filters["Status"] || "");
		setSelectedModelId(filters["Model"] || "");
		setSelectedEndUser(filters["End User"] || "");

		// Key Alias filtering is handled server-side by performSearch via the key_alias param.
		// We intentionally do not translate the alias to a hash here to avoid firing a
		// redundant main-query request (api_key=hash) alongside performSearch's key_alias request.
		setSelectedKeyHash(filters["Key Hash"] || "");
		/* eslint-enable react-hooks/set-state-in-effect */
	}, [filters, accessToken]);

	const searchedLogs = useMemo(
		() =>
			filteredLogs.data.filter((log) => {
				const matchesSearch =
					!searchTerm ||
					log.request_id.includes(searchTerm) ||
					log.model.includes(searchTerm) ||
					(log.user && log.user.includes(searchTerm));

				// No need for additional filtering since we're now handling this in the API call
				return matchesSearch;
			}),
		[filteredLogs.data, searchTerm],
	);

	// Add this function to handle manual refresh
	const handleRefresh = useCallback(() => {
		setIsManualRefreshing(true);
		void logs.refetch().finally(() => setIsManualRefreshing(false));
	}, [logs.refetch]);

	const handleRowClick = useCallback((log: LogEntry) => {
		if (log.status === "in_progress") {
			return;
		}
		// A session-backed request opens the drawer in session mode and loads every log in that session.
		const sessionGroup = getSessionGroupRef(log);
		if (sessionGroup) {
			setSelectedSessionGroup(sessionGroup);
			setSelectedLog(log);
			setIsDrawerOpen(true);
			return;
		}
		// Single-call row: open the detail drawer
		setSelectedSessionGroup(null);
		setSelectedLog(log);
		setIsDrawerOpen(true);
	}, []);

	const handleCloseDrawer = useCallback(() => {
		setIsDrawerOpen(false);
		setSelectedSessionGroup(null);
	}, []);

	const handleSelectLog = useCallback((log: LogEntry) => {
		setSelectedLog(log);
	}, []);

	const handleKeyHashClick = useCallback((keyHash: string) => {
		setSelectedKeyIdInfoView(keyHash);
	}, []);

	const handleSessionClick = useCallback((sessionGroup: SessionGroupRef) => {
		setSimulationSessionGroup(sessionGroup);
	}, []);

	const handleSortChange = useCallback((newSortBy: LogsSortField, newSortOrder: "asc" | "desc") => {
		setSortBy(newSortBy);
		setSortOrder(newSortOrder);
		setCurrentPage(1);
	}, []);

	const logColumns = useMemo(
		() =>
			createColumns({
				sortBy,
				sortOrder,
				onSortChange: handleSortChange,
				onKeyHashClick: handleKeyHashClick,
				onSessionClick: handleSessionClick,
			}),
		[handleKeyHashClick, handleSessionClick, handleSortChange, sortBy, sortOrder],
	);

	const logFilterOptions: FilterOption[] = [
		{
			name: "Team ID",
			label: "Team ID",
			isSearchable: true,
			searchFn: async (searchText: string) => {
				if (!allTeams || allTeams.length === 0) return [];
				const filtered = allTeams.filter((team: Team) => {
					return (
						team.team_id.toLowerCase().includes(searchText.toLowerCase()) ||
						(team.team_alias && team.team_alias.toLowerCase().includes(searchText.toLowerCase()))
					);
				});
				return filtered.map((team: Team) => ({
					label: `${team.team_alias || team.team_id} (${team.team_id})`,
					value: team.team_id,
				}));
			},
		},
		{
			name: "Status",
			label: "Status",
			isSearchable: false,
			options: [
				{ label: "In Progress", value: "in_progress" },
				{ label: "Success", value: "success" },
				{ label: "Failure", value: "failure" },
				{ label: "Aborted", value: "aborted" },
			],
		},
		{
			name: "Model",
			label: "Model",
			customComponent: PaginatedModelSelect,
		},
		{
			name: "Key Alias",
			label: "Key Alias",
			customComponent: PaginatedKeyAliasSelect,
		},
		{
			name: "End User",
			label: "End User",
			isSearchable: true,
			searchFn: async (searchText: string) => {
				if (!accessToken) return [];
				const data = await allEndUsersCall(accessToken);
				// data if set, is a list of objects, with key = user_id
				const users = data?.map((u: any) => u.user_id) || [];
				const filtered = users.filter((u: string) => u.toLowerCase().includes(searchText.toLowerCase()));
				return filtered.map((u: string) => ({ label: u, value: u }));
			},
		},
		{
			name: "Error Code",
			label: "Error Code",
			isSearchable: true,
			searchFn: async (searchText: string) => {
				if (!searchText) return ERROR_CODE_OPTIONS;
				const lower = searchText.toLowerCase();
				const filtered = ERROR_CODE_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(lower));
				const isExactValue = ERROR_CODE_OPTIONS.some((opt) => opt.value === searchText.trim());
				if (!isExactValue && searchText.trim()) {
					filtered.push({ label: `Use custom code: ${searchText.trim()}`, value: searchText.trim() });
				}
				return filtered;
			},
		},
		{
			name: "Key Hash",
			label: "Key Hash",
			isSearchable: false,
		},
		{
			name: "Error Message",
			label: "Error Message",
			isSearchable: false,
		},
	];

	if (!accessToken || !token || !userRole || !userID) {
		return null;
	}

	return (
		<div className="w-full max-w-screen p-6 overflow-x-hidden box-border">
			<TabGroup defaultIndex={0} onIndexChange={(index) => setActiveTab(index === 0 ? "request logs" : "audit logs")}>
				<TabList>
					<Tab>Request Logs</Tab>
					<Tab>Audit Logs</Tab>
					<Tab>Deleted Keys</Tab>
					<Tab>Deleted Teams</Tab>
				</TabList>
				<TabPanels>
					<TabPanel>
						<div className="flex items-center justify-between mb-4">
							<h1 className="text-xl font-semibold">Request Logs</h1>
							<Button
								icon={<SettingOutlined />}
								onClick={() => setIsSpendLogsSettingsModalVisible(true)}
								title="Spend Logs Settings"
							/>
						</div>
						{selectedKeyInfo && selectedKeyIdInfoView && selectedKeyInfo.api_key === selectedKeyIdInfoView ? (
							<KeyInfoView
								keyId={selectedKeyIdInfoView}
								keyData={selectedKeyInfo}
								teams={allTeams}
								onClose={() => setSelectedKeyIdInfoView(null)}
								backButtonText="Back to Logs"
							/>
						) : (
							<>
								<FilterComponent
									options={logFilterOptions}
									onApplyFilters={handleFilterChange}
									onResetFilters={handleFilterReset}
								/>
								<SpendLogsSettingsModal
									isVisible={isSpendLogsSettingsModalVisible}
									onCancel={() => setIsSpendLogsSettingsModalVisible(false)}
									onSuccess={() => setIsSpendLogsSettingsModalVisible(false)}
								/>
								<div className="bg-white rounded-lg shadow w-full max-w-full box-border">
									<div className="border-b px-6 py-4 w-full max-w-full box-border">
										<div
											data-testid="logs-controls-row"
											className="flex w-full min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
										>
											<div className="min-w-0 flex-1">
												<LogsToolbar
													searchTerm={searchTerm}
													startTime={startTime}
													endTime={endTime}
													customDate={isCustomDate}
													selectedInterval={selectedTimeInterval}
													liveTailIntervalMs={liveTailIntervalMs}
													fetching={isManualRefreshing}
													onSearchTermChange={setSearchTerm}
													onStartTimeChange={setStartTime}
													onEndTimeChange={setEndTime}
													onCustomDateChange={setIsCustomDate}
													onSelectedIntervalChange={setSelectedTimeInterval}
													onLiveTailIntervalChange={setLiveTailIntervalMs}
													onRefresh={handleRefresh}
													onPageReset={() => setCurrentPage(1)}
												/>
											</div>
											<LogsPagination
												currentPage={currentPage}
												pageSize={pageSize}
												total={filteredLogs.total}
												totalPages={filteredLogs.total_pages}
												loading={logs.isLoading}
												onPageChange={setCurrentPage}
												onPageSizeChange={(size) => {
													setPageSize(size);
													setCurrentPage(1);
												}}
											/>
										</div>
									</div>
									<LiveTailBanner
										visible={liveTailIntervalMs > 0 && currentPage === 1 && isMainQueryEnabled}
										intervalMs={liveTailIntervalMs}
										onStop={() => setLiveTailIntervalMs(0)}
									/>
									<DataTable
										columns={logColumns}
										data={searchedLogs}
										onRowClick={handleRowClick}
										isLoading={logs.isLoading}
									/>
								</div>
							</>
						)}
					</TabPanel>
					<TabPanel>
						<AuditLogs
							userID={userID}
							userRole={userRole}
							token={token}
							accessToken={accessToken}
							isActive={activeTab === "audit logs"}
							premiumUser={premiumUser}
						/>
					</TabPanel>
					<TabPanel>
						<DeletedKeysPage />
					</TabPanel>
					<TabPanel>
						<DeletedTeamsPage />
					</TabPanel>
				</TabPanels>
			</TabGroup>

			{/* Log Details Drawer */}
			<LogDetailsDrawer
				open={isDrawerOpen}
				onClose={handleCloseDrawer}
				logEntry={selectedLog}
				sessionGroup={selectedSessionGroup}
				teamId={selectedTeamId || undefined}
				accessToken={accessToken}
				onOpenSettings={() => setIsSpendLogsSettingsModalVisible(true)}
				allLogs={searchedLogs}
				onSelectLog={handleSelectLog}
				startTime={moment(startTime).utc().format("YYYY-MM-DD HH:mm:ss")}
			/>
			{simulationSessionGroup ? (
				<SessionSimulationDrawer
					open={true}
					onClose={() => setSimulationSessionGroup(null)}
					onOpenLog={(event) => {
						const log =
							searchedLogs.find((candidate) => candidate.request_id === event.request_id) ??
							({
								request_id: event.request_id,
								api_key: "",
								team_id: selectedTeamId,
								model: event.model,
								model_id: "",
								call_type: "completion",
								spend: 0,
								total_tokens: 0,
								prompt_tokens: 0,
								completion_tokens: 0,
								startTime: event.timestamp,
								endTime: event.timestamp,
								cache_hit: "",
								messages: [],
								response: {},
								metadata: event.status ? { status: event.status } : {},
								status: event.status,
								session_group_type: simulationSessionGroup.type,
								session_group_id: simulationSessionGroup.id,
							} satisfies LogEntry);
						setSimulationSessionGroup(null);
						setSelectedSessionGroup(simulationSessionGroup);
						setSelectedLog(log);
						setIsDrawerOpen(true);
					}}
					sessionGroup={simulationSessionGroup}
					teamId={selectedTeamId || undefined}
					accessToken={accessToken}
				/>
			) : null}
		</div>
	);
}

export { RequestViewer } from "./RequestViewer";
