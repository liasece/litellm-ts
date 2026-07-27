import { useCredentials } from "@/app/(dashboard)/hooks/credentials/useCredentials";
import { useModelCostMap } from "@/app/(dashboard)/hooks/models/useModelCostMap";
import { useModelsInfo } from "@/app/(dashboard)/hooks/models/useModels";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import AllModelsTab from "@/app/(dashboard)/models-and-endpoints/components/AllModelsTab";
import ModelRetrySettingsTab from "@/app/(dashboard)/models-and-endpoints/components/ModelRetrySettingsTab";
import PriceDataManagementTab from "@/app/(dashboard)/models-and-endpoints/components/PriceDataManagementTab";
import { handleAddModelSubmit } from "@/components/add_model/handle_add_model_submit";
import { Team } from "@/components/key_team_helpers/key_list";
import CredentialsPanel from "@/components/model_add/credentials";
import { getCallbacksCall, setCallbacksCall } from "@/components/networking";
import { Providers, getPlaceholder, getProviderModels } from "@/components/provider_info_helpers";
import { getDisplayModelName } from "@/components/view_model/model_name_display";
import { transformModelData } from "./utils/modelDataTransformer";
import { all_admin_roles, internalUserRoles, isProxyAdminRole, isUserTeamAdminForAnyTeam } from "@/utils/roles";
import { RefreshIcon } from "@heroicons/react/outline";
import { useQueryClient } from "@tanstack/react-query";
import { Col, Grid, Icon, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import type { UploadProps } from "antd";
import { Form, Typography } from "antd";
import { PlusCircleOutlined } from "@ant-design/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import AddModelTab from "../../../components/add_model/add_model_tab";
import HealthCheckComponent from "../../../components/model_dashboard/HealthCheckComponent";
import ModelGroupAliasSettings from "../../../components/model_group_alias_settings";
import ModelInfoView from "../../../components/model_info_view";
import NotificationsManager from "../../../components/molecules/notifications_manager";
import PassThroughSettings from "../../../components/pass_through_settings";
import TeamInfoView from "../../../components/team/TeamInfo";
import useAuthorized from "../hooks/useAuthorized";

interface ModelDashboardProps {
  token: string | null;
  modelData: any;
  keys: any[] | null;
  setModelData: any;
  premiumUser: boolean;
  teams: Team[] | null;
}

interface RetryPolicyObject {
  [key: string]: { [retryPolicyKey: string]: number } | undefined;
}

interface GlobalRetryPolicyObject {
  [retryPolicyKey: string]: number;
}

const MODEL_TAB_KEYS = {
  MODELS: "models",
  ADD_MODEL: "add-model",
  CREDENTIALS: "credentials",
  PASS_THROUGH: "pass-through",
  HEALTH: "health",
  RETRIES: "retries",
  ALIASES: "aliases",
  PRICE_DATA: "price-data",
} as const;

type ModelTabKey = (typeof MODEL_TAB_KEYS)[keyof typeof MODEL_TAB_KEYS];

const MODEL_TABS_REQUIRING_MODELS = new Set<ModelTabKey>([
  MODEL_TAB_KEYS.MODELS,
  MODEL_TAB_KEYS.PASS_THROUGH,
  MODEL_TAB_KEYS.HEALTH,
  MODEL_TAB_KEYS.RETRIES,
]);

const MODEL_TABS_REQUIRING_COST_MAP = new Set<ModelTabKey>([
  MODEL_TAB_KEYS.MODELS,
  MODEL_TAB_KEYS.ADD_MODEL,
  MODEL_TAB_KEYS.PASS_THROUGH,
  MODEL_TAB_KEYS.HEALTH,
]);

const MODEL_TABS_REQUIRING_ROUTER_SETTINGS = new Set<ModelTabKey>([MODEL_TAB_KEYS.RETRIES, MODEL_TAB_KEYS.ALIASES]);

const ModelsAndEndpointsView: React.FC<ModelDashboardProps> = ({ premiumUser, teams }) => {
  const { accessToken, token, userRole, userId: userID } = useAuthorized();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [addModelForm] = Form.useForm();
  const [lastRefreshed, setLastRefreshed] = useState("");
  const [providerModels, setProviderModels] = useState<Array<string>>([]);
  const [selectedProvider, setSelectedProvider] = useState<Providers>(Providers.Anthropic);
  const [selectedModelGroup, setSelectedModelGroup] = useState<string | null>(null);

  const [modelGroupRetryPolicy, setModelGroupRetryPolicy] = useState<RetryPolicyObject | null>(null);
  const [globalRetryPolicy, setGlobalRetryPolicy] = useState<GlobalRetryPolicyObject | null>(null);
  const [defaultRetry, setDefaultRetry] = useState<number>(0);
  const [modelGroupAlias, setModelGroupAlias] = useState<{ [key: string]: string }>({});
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: uiSettings, isLoading: isLoadingUISettings } = useUISettings();

  const isProxyAdmin = Boolean(userRole && isProxyAdminRole(userRole));
  const isInternalUser = Boolean(userRole && internalUserRoles.includes(userRole));
  const isUserTeamAdmin = Boolean(userID && isUserTeamAdminForAnyTeam(teams, userID));
  const addModelDisabledForInternalUsers =
    isInternalUser && uiSettings?.values?.disable_model_add_for_internal_users === true;
  // Hide tab if user is NOT a proxy admin AND (internal user with setting enabled OR not a team admin)
  const shouldHideAddModelTab = !isProxyAdmin && (addModelDisabledForInternalUsers || !isUserTeamAdmin);
  const isAdmin = all_admin_roles.includes(userRole);

  const visibleTabKeys = useMemo<ModelTabKey[]>(() => {
    const tabs: ModelTabKey[] = [MODEL_TAB_KEYS.MODELS];
    if (!shouldHideAddModelTab) tabs.push(MODEL_TAB_KEYS.ADD_MODEL);
    if (isAdmin) {
      tabs.push(
        MODEL_TAB_KEYS.CREDENTIALS,
        MODEL_TAB_KEYS.PASS_THROUGH,
        MODEL_TAB_KEYS.HEALTH,
        MODEL_TAB_KEYS.RETRIES,
        MODEL_TAB_KEYS.ALIASES,
        MODEL_TAB_KEYS.PRICE_DATA,
      );
    }
    return tabs;
  }, [isAdmin, shouldHideAddModelTab]);

  const requestedTab = searchParams.get("tab");
  const selectedTabKey = visibleTabKeys.includes(requestedTab as ModelTabKey)
    ? (requestedTab as ModelTabKey)
    : visibleTabKeys[0];
  const selectedTabIndex = visibleTabKeys.indexOf(selectedTabKey);

  const shouldLoadModels = MODEL_TABS_REQUIRING_MODELS.has(selectedTabKey);
  const shouldLoadModelCostMap = MODEL_TABS_REQUIRING_COST_MAP.has(selectedTabKey);
  const shouldLoadCredentials = selectedTabKey === MODEL_TAB_KEYS.ADD_MODEL;
  const shouldLoadRouterSettings = MODEL_TABS_REQUIRING_ROUTER_SETTINGS.has(selectedTabKey);

  const {
    data: modelDataResponse,
    isLoading: isLoadingModels,
    refetch: refetchModels,
  } = useModelsInfo(1, 50, undefined, undefined, undefined, undefined, undefined, shouldLoadModels);
  const { data: modelCostMapData, isLoading: isLoadingModelCostMap } = useModelCostMap(shouldLoadModelCostMap, true);
  const { data: credentialsResponse, isLoading: isLoadingCredentials } = useCredentials(shouldLoadCredentials);
  const credentialsList = credentialsResponse?.credentials || [];

  const updateTabInUrl = useCallback(
    (tabKey: ModelTabKey) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set("tab", tabKey);
      const query = nextSearchParams.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleTabChange = (index: number) => {
    const tabKey = visibleTabKeys[index];
    if (tabKey && tabKey !== selectedTabKey) {
      updateTabInUrl(tabKey);
    }
  };

  useEffect(() => {
    if (requestedTab && requestedTab !== selectedTabKey) {
      updateTabInUrl(selectedTabKey);
    }
  }, [requestedTab, selectedTabKey, updateTabInUrl]);

  const availableModelGroups = useMemo(() => {
    if (!modelDataResponse?.data) return [];
    const allModelGroups = new Set<string>();
    for (const model of modelDataResponse.data) {
      allModelGroups.add(model.model_name);
    }
    return Array.from(allModelGroups).sort();
  }, [modelDataResponse?.data]);

  const availableModelAccessGroups = useMemo(() => {
    if (!modelDataResponse?.data) return [];
    const allModelAccessGroups = new Set<string>();
    for (const model of modelDataResponse.data) {
      const modelInfo = model.model_info;
      if (modelInfo?.access_groups) {
        for (const group of modelInfo.access_groups) {
          allModelAccessGroups.add(group);
        }
      }
    }
    return Array.from(allModelAccessGroups);
  }, [modelDataResponse?.data]);

  const allModelsOnProxy = useMemo<string[]>(() => {
    if (!modelDataResponse?.data) return [];
    return modelDataResponse.data.map((model: any) => model.model_name);
  }, [modelDataResponse?.data]);

  const allModelIdsOnProxy = useMemo<string[]>(() => {
    if (!modelDataResponse?.data) return [];
    return modelDataResponse.data
      .map((model: any) => model.model_info?.id)
      .filter((id: string | undefined): id is string => Boolean(id));
  }, [modelDataResponse?.data]);

  const getProviderFromModel = (model: string) => {
    if (modelCostMapData !== null && modelCostMapData !== undefined) {
      if (typeof modelCostMapData == "object" && model in modelCostMapData) {
        return modelCostMapData[model]["litellm_provider"];
      }
    }
    return "openai";
  };

  const processedModelData = useMemo(() => {
    if (!modelDataResponse?.data) return { data: [] };
    return transformModelData(modelDataResponse, getProviderFromModel);
  }, [modelDataResponse?.data, getProviderFromModel]);

  const setProviderModelsFn = (provider: Providers) => {
    const _providerModels = getProviderModels(provider, modelCostMapData);
    setProviderModels(_providerModels);
  };

  const uploadProps: UploadProps = {
    name: "file",
    accept: ".json",
    pastable: false,
    beforeUpload: (file) => {
      if (file.type === "application/json") {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target) {
            const jsonStr = e.target.result as string;
            addModelForm.setFieldsValue({ vertex_credentials: jsonStr });
          }
        };
        reader.readAsText(file);
      }
      return false;
    },
    onChange(info) {
      if (info.file.status === "done") {
        NotificationsManager.success(`${info.file.name} file uploaded successfully`);
      } else if (info.file.status === "error") {
        NotificationsManager.fromBackend(`${info.file.name} file upload failed.`);
      }
    },
  };

  const handleRefreshClick = () => {
    const currentDate = new Date();
    setLastRefreshed(currentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    queryClient.invalidateQueries({ queryKey: ["models", "list"] });
    refetchModels();
  };

  const handleSaveRetrySettings = async () => {
    if (!accessToken) {
      return;
    }

    try {
      const payload: any = {
        router_settings: {},
      };

      if (selectedModelGroup === "global") {
        if (globalRetryPolicy) {
          payload.router_settings.retry_policy = globalRetryPolicy;
        }
        NotificationsManager.success("Global retry settings saved successfully");
      } else {
        if (modelGroupRetryPolicy) {
          payload.router_settings.model_group_retry_policy = modelGroupRetryPolicy;
        }
        NotificationsManager.success(`Retry settings saved successfully for ${selectedModelGroup}`);
      }

      await setCallbacksCall(accessToken, payload);
    } catch (error) {
      NotificationsManager.fromBackend("Failed to save retry settings");
    }
  };

  useEffect(() => {
    if (!shouldLoadRouterSettings || !accessToken || !token || !userRole || !userID) {
      return;
    }
    const fetchData = async () => {
      try {
        const routerSettingsInfo = await getCallbacksCall(accessToken, userID, userRole);
        let router_settings = routerSettingsInfo.router_settings;

        let model_group_retry_policy = router_settings.model_group_retry_policy;
        let default_retries = router_settings.num_retries;

        setModelGroupRetryPolicy(model_group_retry_policy);
        setGlobalRetryPolicy(router_settings.retry_policy);
        setDefaultRetry(default_retries);

        const model_group_alias = router_settings.model_group_alias || {};
        setModelGroupAlias(model_group_alias);
      } catch (error) {
        console.error("Error fetching model data:", error);
      }
    };

    fetchData();
  }, [accessToken, shouldLoadRouterSettings, token, userID, userRole]);

  const isLoading = isLoadingModels || isLoadingModelCostMap || isLoadingCredentials || isLoadingUISettings;

  if (userRole && userRole == "Admin Viewer") {
    const { Title, Paragraph } = Typography;
    return (
      <div>
        <Title level={1}>Access Denied</Title>
        <Paragraph>Ask your proxy admin for access to view all models</Paragraph>
      </div>
    );
  }

  const handleOk = async () => {
    try {
      const values = await addModelForm.validateFields();
      await handleAddModelSubmit(values, accessToken, addModelForm, handleRefreshClick);
    } catch (error: any) {
      const errorMessages =
        error.errorFields
          ?.map((field: any) => {
            return `${field.name.join(".")}: ${field.errors.join(", ")}`;
          })
          .join(" | ") || "Unknown validation error";
      NotificationsManager.fromBackend(`Please fill in the following required fields: ${errorMessages}`);
    }
  };

  Object.keys(Providers).find((key) => (Providers as { [index: string]: any })[key] === selectedProvider);
  return (
    <div className="w-full mx-4 h-[75vh]">
      <Grid numItems={1} className="gap-2 p-8 w-full mt-2">
        <Col numColSpan={1} className="flex flex-col gap-2">
          {/* Model Management Header */}
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold">Model Management</h2>
              {!all_admin_roles.includes(userRole) ? (
                <p className="text-sm text-gray-600">Add models for teams you are an admin for.</p>
              ) : (
                <p className="text-sm text-gray-600">Add and manage models for the proxy</p>
              )}
            </div>
            <a
              href="https://models.litellm.ai/?request=true"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6366f1] hover:text-[#5558e3] border border-[#6366f1] hover:border-[#5558e3] rounded-lg transition-colors"
            >
              <PlusCircleOutlined style={{ fontSize: "12px" }} />
              Request Provider
            </a>
          </div>
          <TabGroup index={selectedTabIndex} onIndexChange={handleTabChange} className="gap-2 h-[75vh] w-full ">
            <TabList className="flex justify-between mt-2 w-full items-center">
              <div className="flex">
                {isAdmin ? <Tab>All Models</Tab> : <Tab>Your Models</Tab>}
                {!shouldHideAddModelTab && <Tab>Add Model</Tab>}
                {isAdmin && <Tab>LLM Credentials</Tab>}
                {isAdmin && <Tab>Pass-Through Endpoints</Tab>}
                {isAdmin && <Tab>Health Status</Tab>}
                {isAdmin && <Tab>Model Retry Settings</Tab>}
                {isAdmin && <Tab>Model Group Alias</Tab>}
                {isAdmin && <Tab>Price Data Reload</Tab>}
              </div>

              <div className="flex items-center space-x-2 self-center">
                {lastRefreshed && <span className="text-xs text-gray-500">Last Refreshed: {lastRefreshed}</span>}
                <Icon
                  icon={RefreshIcon}
                  variant="shadow"
                  size="xs"
                  className="cursor-pointer"
                  onClick={handleRefreshClick}
                />
              </div>
            </TabList>
            <TabPanels>
              {selectedTabKey === MODEL_TAB_KEYS.MODELS ? (
                <AllModelsTab
                  selectedModelGroup={selectedModelGroup}
                  setSelectedModelGroup={setSelectedModelGroup}
                  availableModelGroups={availableModelGroups}
                  availableModelAccessGroups={availableModelAccessGroups}
                  setSelectedModelId={setSelectedModelId}
                  setSelectedTeamId={setSelectedTeamId}
                />
              ) : (
                <TabPanel />
              )}
              {!shouldHideAddModelTab && (
                <TabPanel className="h-full">
                  {selectedTabKey === MODEL_TAB_KEYS.ADD_MODEL && (
                    <AddModelTab
                      form={addModelForm}
                      handleOk={handleOk}
                      selectedProvider={selectedProvider}
                      setSelectedProvider={setSelectedProvider}
                      providerModels={providerModels}
                      setProviderModelsFn={setProviderModelsFn}
                      getPlaceholder={getPlaceholder}
                      uploadProps={uploadProps}
                      showAdvancedSettings={showAdvancedSettings}
                      setShowAdvancedSettings={setShowAdvancedSettings}
                      teams={teams}
                      credentials={credentialsList}
                      accessToken={accessToken}
                      userRole={userRole}
                    />
                  )}
                </TabPanel>
              )}
              {isAdmin && (
                <TabPanel>
                  {selectedTabKey === MODEL_TAB_KEYS.CREDENTIALS && <CredentialsPanel uploadProps={uploadProps} />}
                </TabPanel>
              )}
              {isAdmin && (
                <TabPanel>
                  {selectedTabKey === MODEL_TAB_KEYS.PASS_THROUGH && (
                    <PassThroughSettings
                      accessToken={accessToken}
                      userRole={userRole}
                      userID={userID}
                      modelData={processedModelData}
                      premiumUser={premiumUser}
                    />
                  )}
                </TabPanel>
              )}
              {isAdmin && (
                <TabPanel>
                  {selectedTabKey === MODEL_TAB_KEYS.HEALTH && (
                    <HealthCheckComponent
                      accessToken={accessToken}
                      modelData={processedModelData}
                      all_models_on_proxy={allModelIdsOnProxy}
                      getDisplayModelName={getDisplayModelName}
                      setSelectedModelId={setSelectedModelId}
                      teams={teams}
                    />
                  )}
                </TabPanel>
              )}
              {isAdmin &&
                (selectedTabKey === MODEL_TAB_KEYS.RETRIES ? (
                  <ModelRetrySettingsTab
                    selectedModelGroup={selectedModelGroup}
                    setSelectedModelGroup={setSelectedModelGroup}
                    availableModelGroups={availableModelGroups}
                    globalRetryPolicy={globalRetryPolicy}
                    setGlobalRetryPolicy={setGlobalRetryPolicy}
                    defaultRetry={defaultRetry}
                    modelGroupRetryPolicy={modelGroupRetryPolicy}
                    setModelGroupRetryPolicy={setModelGroupRetryPolicy}
                    handleSaveRetrySettings={handleSaveRetrySettings}
                  />
                ) : (
                  <TabPanel />
                ))}
              {isAdmin && (
                <TabPanel>
                  {selectedTabKey === MODEL_TAB_KEYS.ALIASES && (
                    <ModelGroupAliasSettings
                      accessToken={accessToken}
                      initialModelGroupAlias={modelGroupAlias}
                      onAliasUpdate={setModelGroupAlias}
                    />
                  )}
                </TabPanel>
              )}
              {isAdmin && (selectedTabKey === MODEL_TAB_KEYS.PRICE_DATA ? <PriceDataManagementTab /> : <TabPanel />)}
            </TabPanels>
          </TabGroup>
          {selectedModelId && !isLoading && (
            <ModelInfoView
              modelId={selectedModelId}
              onClose={() => setSelectedModelId(null)}
              accessToken={accessToken}
              userID={userID}
              userRole={userRole}
              onModelUpdate={() => {
                queryClient.invalidateQueries({ queryKey: ["models", "list"] });
                handleRefreshClick();
              }}
              modelAccessGroups={availableModelAccessGroups}
            />
          )}
          {selectedTeamId && (
            <TeamInfoView
              teamId={selectedTeamId}
              onClose={() => setSelectedTeamId(null)}
              accessToken={accessToken}
              is_team_admin={userRole === "Admin"}
              is_proxy_admin={userRole === "Proxy Admin"}
              userModels={allModelsOnProxy}
              editTeam={false}
              onUpdate={handleRefreshClick}
              premiumUser={premiumUser}
            />
          )}
        </Col>
      </Grid>
    </div>
  );
};

export default ModelsAndEndpointsView;
