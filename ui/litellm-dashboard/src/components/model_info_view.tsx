import { useModelCostMap } from "@/app/(dashboard)/hooks/models/useModelCostMap";
import { useModelHub, useModelsInfo } from "@/app/(dashboard)/hooks/models/useModels";
import { transformModelData } from "@/app/(dashboard)/models-and-endpoints/utils/modelDataTransformer";
import { Text } from "@tremor/react";
import { Button, Form } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { copyToClipboard as utilCopyToClipboard } from "../utils/dataUtils";
import { truncateString } from "../utils/textUtils";
import ResourceDetailsDrawer from "./common_components/ResourceDetailsDrawer";
import NotificationsManager from "./molecules/notifications_manager";
import ModelDetailsHeader from "./model_details/ModelDetailsHeader";
import ModelDetailsDialogs from "./model_details/ModelDetailsDialogs";
import ModelDetailsTabs from "./model_details/ModelDetailsTabs";
import {
	CredentialItem,
	credentialCreateCall,
	credentialGetCall,
	credentialListCall,
	getGuardrailsList,
	modelDeleteCall,
	modelInfoV1Call,
	modelPatchUpdateCall,
	tagListCall,
	testConnectionRequest,
} from "./networking";
import { Tag } from "./tag_management/types";
import { getDisplayModelName } from "./view_model/model_name_display";

interface ModelInfoViewProps {
	modelId: string;
	onClose: () => void;
	accessToken: string | null;
	userID: string | null;
	userRole: string | null;
	onModelUpdate?: (updatedModel: any) => void;
	modelAccessGroups: string[] | null;
}

const normalizeModelData = (modelData: any) => {
	if (!modelData || modelData.litellm_model_name) return modelData;
	return {
		...modelData,
		litellm_model_name:
			modelData.litellm_params?.litellm_model_name ??
			modelData.litellm_params?.model ??
			modelData.model_info?.key ??
			null,
	};
};

export const attachCredentialToModel = async (
	accessToken: string,
	modelId: string,
	localModelData: any,
	values: { credential_name: string },
	createCredential: typeof credentialCreateCall,
): Promise<boolean> => {
	if (!localModelData) return false;
	await createCredential(accessToken, {
		credential_name: values.credential_name,
		model_id: modelId,
		attach_to_model: true,
		credential_info: {
			custom_llm_provider: localModelData.litellm_params?.custom_llm_provider,
		},
	});
	return true;
};

export default function ModelInfoView({
	modelId,
	onClose,
	accessToken,
	userID,
	userRole,
	onModelUpdate,
	modelAccessGroups,
}: ModelInfoViewProps) {
	const [form] = Form.useForm();
	const [localModelData, setLocalModelData] = useState<any>(null);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [isCredentialModalOpen, setIsCredentialModalOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [existingCredential, setExistingCredential] = useState<CredentialItem | null>(null);
	const [showCacheControl, setShowCacheControl] = useState<boolean | null>(null);
	const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
	const [isAutoRouterModalOpen, setIsAutoRouterModalOpen] = useState(false);
	const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
	const [tagsList, setTagsList] = useState<Record<string, Tag>>({});
	const [credentialsList, setCredentialsList] = useState<CredentialItem[]>([]);
	const selectedCredentialName = Form.useWatch("litellm_credential_name", form);

	// Fetch model data using hook
	const { data: rawModelDataResponse, isLoading: isLoadingModel } = useModelsInfo(1, 50, undefined, modelId);
	const { data: modelCostMapData } = useModelCostMap();
	const { data: modelHubData } = useModelHub();

	// Transform the model data
	const getProviderFromModel = useCallback(
		(model: string) => {
			if (modelCostMapData !== null && modelCostMapData !== undefined) {
				if (typeof modelCostMapData == "object" && model in modelCostMapData) {
					return modelCostMapData[model]["litellm_provider"];
				}
			}
			return "openai";
		},
		[modelCostMapData],
	);

	const transformedModelData = useMemo(() => {
		if (!rawModelDataResponse?.data || rawModelDataResponse.data.length === 0) {
			return null;
		}
		const transformed = transformModelData(rawModelDataResponse, getProviderFromModel);
		return transformed.data[0] || null;
	}, [rawModelDataResponse, getProviderFromModel]);

	// Keep modelData variable name for backwards compatibility
	const modelData = useMemo(() => normalizeModelData(transformedModelData), [transformedModelData]);
	const currentModelData = localModelData ?? modelData;

	const syncFormWithModel = (updatedModel: any) => {
		const litellmParams = updatedModel.litellm_params || {};
		form.setFieldsValue({
			model_name: updatedModel.model_name,
			litellm_model_name:
				updatedModel.litellm_model_name ??
				litellmParams.litellm_model_name ??
				litellmParams.model ??
				currentModelData?.litellm_model_name,
			api_base: litellmParams.api_base,
			custom_llm_provider: litellmParams.custom_llm_provider,
			organization: litellmParams.organization,
			tpm: litellmParams.tpm,
			rpm: litellmParams.rpm,
			max_retries: litellmParams.max_retries,
			timeout: litellmParams.timeout,
			stream_timeout: litellmParams.stream_timeout,
			input_cost: (litellmParams.input_cost_per_token ?? updatedModel.model_info?.input_cost_per_token) * 1_000_000,
			output_cost: (litellmParams.output_cost_per_token ?? updatedModel.model_info?.output_cost_per_token) * 1_000_000,
			model_access_group: Array.isArray(updatedModel.model_info?.access_groups)
				? updatedModel.model_info.access_groups
				: [],
			guardrails: Array.isArray(litellmParams.guardrails) ? litellmParams.guardrails : [],
			vector_store_ids: Array.isArray(litellmParams.vector_store_ids) ? litellmParams.vector_store_ids : [],
			tags: Array.isArray(litellmParams.tags) ? litellmParams.tags : [],
			health_check_model: updatedModel.model_info?.health_check_model ?? null,
			litellm_credential_name: litellmParams.litellm_credential_name || "",
			api_key: litellmParams.api_key ?? "",
			delete_api_key: false,
			model_info: JSON.stringify(updatedModel.model_info || {}, null, 2),
			litellm_extra_params: JSON.stringify(
				Object.fromEntries(
					Object.entries(litellmParams).filter(([key]) => key !== "litellm_credential_name" && key !== "api_key"),
				),
				null,
				2,
			),
		});
	};

	const canEditModel =
		(userRole === "Admin" || currentModelData?.model_info?.created_by === userID) &&
		currentModelData?.model_info?.db_model;
	const isAdmin = userRole === "Admin";
	const isAutoRouter = currentModelData?.litellm_params?.auto_router_config != null;

	const usingExistingCredential = Boolean(currentModelData?.litellm_params?.litellm_credential_name);

	useEffect(() => {
		const getExistingCredential = async () => {
			if (!accessToken) return;
			if (usingExistingCredential) return;
			const existingCredentialResponse = await credentialGetCall(accessToken, null, modelId);
			setExistingCredential({
				credential_name: existingCredentialResponse["credential_name"],
				credential_values: existingCredentialResponse["credential_values"],
				credential_info: existingCredentialResponse["credential_info"],
			});
		};

		void getExistingCredential();
	}, [accessToken, modelId, usingExistingCredential]);

	useEffect(() => {
		const getModelInfo = async () => {
			if (!accessToken) return;
			// Only fetch if we don't have modelData yet
			if (modelData) return;
			const modelInfoResponse = await modelInfoV1Call(accessToken, modelId);
			const specificModelData = normalizeModelData(modelInfoResponse.data[0]);
			setLocalModelData(specificModelData);

			// Check if cache control is enabled
			if (specificModelData?.litellm_params?.cache_control_injection_points) {
				setShowCacheControl(true);
			}
		};

		void getModelInfo();
	}, [accessToken, modelData, modelId]);

	useEffect(() => {
		const fetchGuardrails = async () => {
			if (!accessToken) return;
			try {
				const response = await getGuardrailsList(accessToken);
				const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
				setGuardrailsList(guardrailNames);
			} catch {
				NotificationsManager.fromBackend("Failed to load guardrails");
			}
		};

		const fetchTags = async () => {
			if (!accessToken) return;
			try {
				const response = await tagListCall(accessToken);
				setTagsList(response);
			} catch {
				NotificationsManager.fromBackend("Failed to load tags");
			}
		};

		const fetchCredentials = async () => {
			if (!accessToken) return;
			try {
				const response = await credentialListCall(accessToken);
				setCredentialsList(response.credentials || []);
			} catch {
				NotificationsManager.fromBackend("Failed to load credentials");
			}
		};

		void fetchGuardrails();
		void fetchTags();
		void fetchCredentials();
	}, [accessToken]);

	const handleReuseCredential = async (values: { credential_name: string }) => {
		if (!accessToken) return;
		const attached = await attachCredentialToModel(
			accessToken,
			modelId,
			currentModelData,
			values,
			credentialCreateCall,
		);
		if (!attached) {
			NotificationsManager.error("Model data is still loading. Please try again.");
			return;
		}
		NotificationsManager.info("Storing credential..");
		const [credentialResponse, modelInfoResponse] = await Promise.all([
			credentialListCall(accessToken),
			modelInfoV1Call(accessToken, modelId),
		]);
		setCredentialsList(credentialResponse.credentials || []);
		const refreshedModel = modelInfoResponse.data?.[0];
		if (refreshedModel) {
			const updatedModelData = {
				...currentModelData,
				...refreshedModel,
				litellm_model_name:
					refreshedModel.litellm_model_name ??
					refreshedModel.litellm_params?.litellm_model_name ??
					refreshedModel.litellm_params?.model ??
					currentModelData.litellm_model_name,
			};
			setLocalModelData(updatedModelData);
			syncFormWithModel(updatedModelData);
			onModelUpdate?.(updatedModelData);
		}
		NotificationsManager.success("Credential stored successfully");
	};

	const handleModelUpdate = async (values: any) => {
		try {
			if (!accessToken) return;
			setIsSaving(true);

			// Parse LiteLLM extra params from JSON text area
			let parsedExtraParams: Record<string, any> = {};
			try {
				parsedExtraParams = values.litellm_extra_params ? JSON.parse(values.litellm_extra_params) : {};
				delete parsedExtraParams.litellm_credential_name;
				delete parsedExtraParams.api_key;
			} catch (e) {
				NotificationsManager.fromBackend("Invalid JSON in LiteLLM Params");
				setIsSaving(false);
				return;
			}

			let updatedLitellmParams = {
				...values.litellm_params,
				...parsedExtraParams,
				model: values.litellm_model_name,
				api_base: values.api_base,
				custom_llm_provider: values.custom_llm_provider,
				organization: values.organization,
				tpm: values.tpm,
				rpm: values.rpm,
				max_retries: values.max_retries,
				timeout: values.timeout,
				stream_timeout: values.stream_timeout,
				input_cost_per_token: values.input_cost / 1_000_000,
				output_cost_per_token: values.output_cost / 1_000_000,
				tags: values.tags,
			};
			const selectedCredentialName = values.litellm_credential_name || null;
			const replacementApiKey = typeof values.api_key === "string" ? values.api_key.trim() : "";
			if (selectedCredentialName) {
				updatedLitellmParams.litellm_credential_name = selectedCredentialName;
				updatedLitellmParams.api_key = null;
			} else {
				updatedLitellmParams.litellm_credential_name = null;
				if (values.delete_api_key) {
					updatedLitellmParams.api_key = null;
				} else if (replacementApiKey) {
					updatedLitellmParams.api_key = replacementApiKey;
				} else if (usingExistingCredential) {
					NotificationsManager.error("Enter a new API key before switching to Manual credentials");
					return;
				} else {
					delete updatedLitellmParams.api_key;
				}
			}
			if (values.guardrails) {
				updatedLitellmParams.guardrails = values.guardrails;
			}
			if (values.vector_store_ids !== undefined) {
				updatedLitellmParams.vector_store_ids = Array.isArray(values.vector_store_ids) ? values.vector_store_ids : [];
			}

			// Handle cache control settings
			if (values.cache_control && values.cache_control_injection_points?.length > 0) {
				updatedLitellmParams.cache_control_injection_points = values.cache_control_injection_points;
			} else {
				delete updatedLitellmParams.cache_control_injection_points;
			}

			// Parse the model_info from the form values
			let updatedModelInfo;
			try {
				updatedModelInfo = values.model_info ? JSON.parse(values.model_info) : currentModelData?.model_info;
				// Update access_groups from the form
				if (values.model_access_group) {
					updatedModelInfo = {
						...updatedModelInfo,
						access_groups: values.model_access_group,
					};
				}
				// Override health_check_model from the form
				if (values.health_check_model !== undefined) {
					updatedModelInfo = {
						...updatedModelInfo,
						health_check_model: values.health_check_model,
					};
				}
			} catch (e) {
				NotificationsManager.fromBackend("Invalid JSON in Model Info");
				return;
			}

			const updateData = {
				model_name: values.model_name,
				litellm_params: updatedLitellmParams,
				model_info: updatedModelInfo,
			};

			const patchResponse = await modelPatchUpdateCall(accessToken, updateData, modelId);
			const returnedModelData =
				patchResponse?.data?.[0] ?? patchResponse?.data ?? patchResponse?.model ?? patchResponse;
			const hasReturnedModelData = returnedModelData && Object.keys(returnedModelData).length > 0;
			const updatedModelData = hasReturnedModelData
				? {
						...currentModelData,
						...returnedModelData,
						litellm_params: {
							...currentModelData?.litellm_params,
							...returnedModelData.litellm_params,
						},
						model_info: {
							...currentModelData?.model_info,
							...returnedModelData.model_info,
						},
					}
				: {
						...currentModelData,
						model_name: values.model_name,
						litellm_model_name: values.litellm_model_name,
						litellm_params: updatedLitellmParams,
						model_info: updatedModelInfo,
					};

			setLocalModelData(updatedModelData);
			syncFormWithModel(updatedModelData);
			onModelUpdate?.(updatedModelData);

			NotificationsManager.success("Model settings updated successfully");
			setIsEditing(false);
		} catch {
			NotificationsManager.fromBackend("Failed to update model settings");
		} finally {
			setIsSaving(false);
		}
	};

	// Show loading state
	if (isLoadingModel) {
		return <Text>Loading...</Text>;
	}

	// Show not found if model is not found
	if (!currentModelData) {
		return <Text>Model not found</Text>;
	}

	const handleTestConnection = async () => {
		if (!accessToken) return;
		try {
			NotificationsManager.info("Testing connection...");
			const response = await testConnectionRequest(
				accessToken,
				{
					custom_llm_provider: currentModelData.litellm_params.custom_llm_provider,
					litellm_credential_name: currentModelData.litellm_params.litellm_credential_name,
					model: currentModelData.litellm_model_name,
				},
				{
					mode: currentModelData.model_info?.mode,
				},
				currentModelData.model_info?.mode,
			);

			if (response.status === "success") {
				NotificationsManager.success("Connection test successful!");
			} else {
				throw new Error(response?.result?.error || response?.message || "Unknown error");
			}
		} catch (error) {
			if (error instanceof Error) {
				NotificationsManager.error("Error testing connection: " + truncateString(error.message, 100));
			} else {
				NotificationsManager.error("Error testing connection: " + String(error));
			}
		}
	};

	const handleDelete = async () => {
		try {
			setDeleteLoading(true);
			if (!accessToken) return;
			await modelDeleteCall(accessToken, modelId);
			NotificationsManager.success("Model deleted successfully");

			if (onModelUpdate) {
				onModelUpdate({
					deleted: true,
					model_info: { id: modelId },
				});
			}

			onClose();
		} catch {
			NotificationsManager.fromBackend("Failed to delete model");
		} finally {
			setDeleteLoading(false);
			setIsDeleteModalOpen(false);
		}
	};

	const copyToClipboard = async (text: string, key: string) => {
		const success = await utilCopyToClipboard(text);
		if (success) {
			setCopiedStates((prev) => ({ ...prev, [key]: true }));
			setTimeout(() => {
				setCopiedStates((prev) => ({ ...prev, [key]: false }));
			}, 2000);
		}
	};

	const handleAutoRouterUpdate = (updatedModel: any) => {
		setLocalModelData(updatedModel);
		if (onModelUpdate) {
			onModelUpdate(updatedModel);
		}
	};
	const isWildcardModel = currentModelData.litellm_model_name.includes("*");
	const cacheControlEnabled =
		showCacheControl ?? Boolean(currentModelData.litellm_params?.cache_control_injection_points);

	return (
		<ResourceDetailsDrawer
			open
			onClose={() => {
				setIsEditing(false);
				onClose();
			}}
			title={`Model: ${getDisplayModelName(currentModelData)}`}
			subtitle={currentModelData.model_info.id}
			actions={
				canEditModel ? (
					<Button type="primary" onClick={() => setIsEditing(true)}>
						Edit
					</Button>
				) : undefined
			}
		>
			<div className="p-4">
				<ModelDetailsHeader
					displayName={getDisplayModelName(currentModelData)}
					modelId={currentModelData.model_info.id}
					modelIdCopied={Boolean(copiedStates["model-id"])}
					canEditModel={canEditModel}
					isAdmin={isAdmin}
					onCopyModelId={() => copyToClipboard(currentModelData.model_info.id, "model-id")}
					onTestConnection={handleTestConnection}
					onReuseCredentials={() => setIsCredentialModalOpen(true)}
					onDeleteModel={() => setIsDeleteModalOpen(true)}
				/>

				<ModelDetailsTabs
					modelData={currentModelData}
					localModelData={currentModelData}
					canEditModel={canEditModel}
					isAutoRouter={isAutoRouter}
					isEditing={isEditing}
					modelAccessGroups={modelAccessGroups}
					accessToken={accessToken}
					guardrails={guardrailsList}
					tags={tagsList}
					selectedCredentialName={selectedCredentialName}
					credentials={credentialsList}
					isWildcardModel={isWildcardModel}
					modelHubData={modelHubData}
					form={form}
					showCacheControl={cacheControlEnabled}
					isSaving={isSaving}
					onEditAutoRouter={() => setIsAutoRouterModalOpen(true)}
					onEditingChange={setIsEditing}
					onCacheControlChange={setShowCacheControl}
					onSave={handleModelUpdate}
				/>

				<ModelDetailsDialogs
					modelData={currentModelData}
					localModelData={currentModelData}
					accessToken={accessToken}
					userRole={userRole}
					deleteOpen={isDeleteModalOpen}
					deleteLoading={deleteLoading}
					credentialOpen={isCredentialModalOpen}
					usingExistingCredential={usingExistingCredential}
					existingCredential={existingCredential}
					autoRouterOpen={isAutoRouterModalOpen}
					onDeleteOpenChange={setIsDeleteModalOpen}
					onDelete={handleDelete}
					onCredentialOpenChange={setIsCredentialModalOpen}
					onReuseCredential={handleReuseCredential}
					onAutoRouterOpenChange={setIsAutoRouterModalOpen}
					onAutoRouterUpdate={handleAutoRouterUpdate}
				/>
			</div>
		</ResourceDetailsDrawer>
	);
}
