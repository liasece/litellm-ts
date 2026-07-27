import { useModelCostMap } from "@/app/(dashboard)/hooks/models/useModelCostMap";
import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import DeleteResourceModal from "@/components/common_components/DeleteResourceModal";
import { Team } from "@/components/key_team_helpers/key_list";
import { AllModelsDataTable } from "@/components/model_dashboard/all_models_table";
import ModelSettingsModal from "@/components/model_dashboard/ModelSettingsModal/ModelSettingsModal";
import { useDeploymentHealth } from "@/components/model_dashboard/useDeploymentHealth";
import FallbackEditModal from "@/components/molecules/models/FallbackEditModal";
import { columns } from "@/components/molecules/models/columns";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { modelDeleteCall } from "@/components/networking";
import { getDisplayModelName } from "@/components/view_model/model_name_display";
import { useQueryClient } from "@tanstack/react-query";
import { PaginationState, SortingState } from "@tanstack/react-table";
import { Grid } from "@tremor/react";
import debounce from "lodash/debounce";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useModelsInfo } from "../../hooks/models/useModels";
import { transformModelData } from "../utils/modelDataTransformer";
import ModelListToolbar from "./ModelListToolbar";
import ModelScopeSelector, { ModelViewMode } from "./ModelScopeSelector";

interface AllModelsTabProps {
	selectedModelGroup: string | null;
	setSelectedModelGroup: (selectedModelGroup: string) => void;
	availableModelGroups: string[];
	availableModelAccessGroups: string[];
	setSelectedModelId: (id: string) => void;
	setSelectedTeamId: (id: string) => void;
}

const DEFAULT_PAGE_SIZE = 50;

const AllModelsTab = ({
	selectedModelGroup,
	setSelectedModelGroup,
	availableModelGroups,
	availableModelAccessGroups,
	setSelectedModelId,
	setSelectedTeamId,
}: AllModelsTabProps) => {
	const { data: modelCostMapData, isLoading: isLoadingModelCostMap } = useModelCostMap();
	const { accessToken, userId, userRole, premiumUser } = useAuthorized();
	const { data: teams, isLoading: isLoadingTeams } = useTeams();
	const queryClient = useQueryClient();

	const [modelNameSearch, setModelNameSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [modelViewMode, setModelViewMode] = useState<ModelViewMode>("current_team");
	const [currentTeam, setCurrentTeam] = useState<Team | "personal">("personal");
	const [showFilters, setShowFilters] = useState(false);
	const [selectedModelAccessGroupFilter, setSelectedModelAccessGroupFilter] = useState<string | null>(null);
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [currentPage, setCurrentPage] = useState(1);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: DEFAULT_PAGE_SIZE,
	});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [isModelSettingsModalVisible, setIsModelSettingsModalVisible] = useState(false);
	const [isRunningAllHealthChecks, setIsRunningAllHealthChecks] = useState(false);
	const [deleteModalModelId, setDeleteModalModelId] = useState<string | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [fallbackEditModel, setFallbackEditModel] = useState<any | null>(null);

	const resetToFirstPage = () => {
		setCurrentPage(1);
		setPagination((previous) => ({ ...previous, pageIndex: 0 }));
	};

	const debouncedUpdateSearch = useMemo(
		() =>
			debounce((value: string) => {
				setDebouncedSearch(value);
				resetToFirstPage();
			}, 200),
		[],
	);

	useEffect(() => {
		debouncedUpdateSearch(modelNameSearch);
		return () => debouncedUpdateSearch.cancel();
	}, [modelNameSearch, debouncedUpdateSearch]);

	const teamIdForQuery = currentTeam === "personal" ? undefined : currentTeam.team_id;
	const sortBy = useMemo(() => {
		if (sorting.length === 0) return undefined;
		const sort = sorting[0];
		const columnIdToServerField: Record<string, string> = {
			input_cost: "costs",
			model_info_db_model: "status",
			model_info_created_by: "created_at",
			model_info_updated_at: "updated_at",
		};
		return columnIdToServerField[sort.id] || sort.id;
	}, [sorting]);
	const sortOrder = useMemo(() => {
		if (sorting.length === 0) return undefined;
		return sorting[0].desc ? "desc" : "asc";
	}, [sorting]);

	const {
		data: rawModelData,
		isLoading: isLoadingModelsInfo,
		refetch: refetchModels,
	} = useModelsInfo(
		currentPage,
		DEFAULT_PAGE_SIZE,
		debouncedSearch || undefined,
		undefined,
		teamIdForQuery,
		sortBy,
		sortOrder,
	);
	const isLoading = isLoadingModelsInfo || isLoadingModelCostMap;

	const getProviderFromModel = useCallback((model: string) => {
		if (modelCostMapData && typeof modelCostMapData === "object" && model in modelCostMapData) {
			return modelCostMapData[model]["litellm_provider"];
		}
		return "openai";
	}, [modelCostMapData]);
	const modelData = useMemo(() => {
		if (!rawModelData) return { data: [] };
		return transformModelData(rawModelData, getProviderFromModel);
	}, [getProviderFromModel, rawModelData]);
	const deploymentIds = useMemo(
		() =>
			modelData.data
				.map((model: any) => model.model_info?.id)
				.filter((id: unknown): id is string => typeof id === "string"),
		[modelData],
	);
	const {
		statuses: deploymentHealthStatuses,
		runOne: runOneHealthCheck,
		runAll: runAllHealthChecks,
	} = useDeploymentHealth(accessToken, deploymentIds);

	const paginationMeta = useMemo(
		() => ({
			total_count: rawModelData?.total_count ?? 0,
			current_page: rawModelData?.current_page ?? 1,
			total_pages: rawModelData?.total_pages ?? 1,
			size: rawModelData?.size ?? DEFAULT_PAGE_SIZE,
		}),
		[rawModelData],
	);
	const filteredData = useMemo(() => {
		if (!modelData.data?.length) return [];
		return modelData.data.filter((model: any) => {
			const modelNameMatches =
				selectedModelGroup === "all" ||
				model.model_name === selectedModelGroup ||
				!selectedModelGroup ||
				(selectedModelGroup === "wildcard" && model.model_name?.includes("*"));
			const accessGroupMatches =
				selectedModelAccessGroupFilter === "all" ||
				model.model_info.access_groups?.includes(selectedModelAccessGroupFilter) ||
				!selectedModelAccessGroupFilter;
			return modelNameMatches && accessGroupMatches;
		});
	}, [modelData, selectedModelGroup, selectedModelAccessGroupFilter]);
	const modelToDelete = useMemo(() => {
		if (!deleteModalModelId) return null;
		return modelData.data.find((model: any) => model.model_info.id === deleteModalModelId);
	}, [deleteModalModelId, modelData]);

	const resetFilters = () => {
		setModelNameSearch("");
		setSelectedModelGroup("all");
		setSelectedModelAccessGroupFilter(null);
		setCurrentTeam("personal");
		setModelViewMode("current_team");
		setCurrentPage(1);
		setPagination({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });
		setSorting([]);
	};

	const handleRunAllHealthChecks = async () => {
		if (deploymentIds.length === 0) {
			NotificationsManager.error("No deployments available");
			return;
		}
		setIsRunningAllHealthChecks(true);
		const succeeded = await runAllHealthChecks();
		setIsRunningAllHealthChecks(false);
		if (!succeeded) NotificationsManager.error("Unable to run health checks");
	};

	const handleDeleteModel = async () => {
		if (!accessToken || !deleteModalModelId) return;
		try {
			setDeleteLoading(true);
			await modelDeleteCall(accessToken, deleteModalModelId);
			NotificationsManager.success("Model deleted successfully");
			queryClient.invalidateQueries({ queryKey: ["models", "list"] });
			refetchModels();
		} catch (error) {
			console.error("Error deleting model:", error);
			NotificationsManager.fromBackend(error);
		} finally {
			setDeleteLoading(false);
			setDeleteModalModelId(null);
		}
	};

	return (
		<>
			<Grid>
				<div className="flex flex-col space-y-4">
					<div className="rounded-lg bg-white shadow">
						<ModelScopeSelector
							currentTeam={currentTeam}
							teams={teams}
							modelViewMode={modelViewMode}
							isLoading={isLoading}
							isLoadingTeams={isLoadingTeams}
							onCurrentTeamChange={(team) => {
								setCurrentTeam(team);
								resetToFirstPage();
							}}
							onViewModeChange={setModelViewMode}
						/>
						<ModelListToolbar
							modelNameSearch={modelNameSearch}
							showFilters={showFilters}
							selectedModelGroup={selectedModelGroup}
							selectedAccessGroup={selectedModelAccessGroupFilter}
							availableModelGroups={availableModelGroups}
							availableModelAccessGroups={availableModelAccessGroups}
							currentPage={currentPage}
							pageSize={DEFAULT_PAGE_SIZE}
							pagination={paginationMeta}
							isLoading={isLoading}
							isRunningAllHealthChecks={isRunningAllHealthChecks}
							onSearchChange={setModelNameSearch}
							onToggleFilters={() => setShowFilters((visible) => !visible)}
							onResetFilters={resetFilters}
							onModelGroupChange={(group) => {
								setSelectedModelGroup(group);
								resetToFirstPage();
							}}
							onAccessGroupChange={(group) => {
								setSelectedModelAccessGroupFilter(group);
								resetToFirstPage();
							}}
							onRunAllHealthChecks={handleRunAllHealthChecks}
							onOpenModelSettings={() => setIsModelSettingsModalVisible(true)}
							onPageChange={(page) => {
								setCurrentPage(page);
								setPagination((previous) => ({ ...previous, pageIndex: 0 }));
							}}
						/>
						<AllModelsDataTable
							columns={columns(
								userRole,
								userId,
								premiumUser,
								setSelectedModelId,
								setSelectedTeamId,
								getDisplayModelName,
								() => {},
								() => {},
								expandedRows,
								setExpandedRows,
								setDeleteModalModelId,
								setFallbackEditModel,
								deploymentHealthStatuses,
								runOneHealthCheck,
							)}
							data={filteredData}
							isLoading={isLoadingModelsInfo}
							sorting={sorting}
							onSortingChange={(nextSorting) => {
								setSorting(nextSorting);
								resetToFirstPage();
							}}
							pagination={pagination}
							onPaginationChange={setPagination}
							enablePagination
							onRowClick={(model: any) => setSelectedModelId(model.model_info.id)}
						/>
					</div>
				</div>
			</Grid>

			<DeleteResourceModal
				isOpen={Boolean(deleteModalModelId)}
				title="Delete Model"
				alertMessage="This action cannot be undone."
				message="Are you sure you want to delete this model?"
				resourceInformationTitle="Model Information"
				resourceInformation={
					modelToDelete
						? [
								{ label: "Model Name", value: modelToDelete.model_name || "Not Set" },
								{ label: "LiteLLM Model Name", value: modelToDelete.litellm_model_name || "Not Set" },
								{ label: "Provider", value: modelToDelete.provider || "Not Set" },
								{ label: "Created By", value: modelToDelete.model_info?.created_by || "Not Set" },
							]
						: []
				}
				onCancel={() => setDeleteModalModelId(null)}
				onOk={handleDeleteModel}
				confirmLoading={deleteLoading}
			/>
			<ModelSettingsModal
				isVisible={isModelSettingsModalVisible}
				onCancel={() => setIsModelSettingsModalVisible(false)}
				onSuccess={() => setIsModelSettingsModalVisible(false)}
			/>
			<FallbackEditModal
				isOpen={Boolean(fallbackEditModel)}
				modelName={fallbackEditModel?.model_name ?? null}
				currentFallbacks={
					Array.isArray(fallbackEditModel?.model_info?.fallbacks) ? fallbackEditModel.model_info.fallbacks : []
				}
				availableModels={availableModelGroups}
				accessToken={accessToken}
				userID={userId}
				userRole={userRole}
				onCancel={() => setFallbackEditModel(null)}
				onSuccess={() => {
					setFallbackEditModel(null);
					queryClient.invalidateQueries({ queryKey: ["models", "list"] });
					refetchModels();
				}}
			/>
		</>
	);
};

export default AllModelsTab;
