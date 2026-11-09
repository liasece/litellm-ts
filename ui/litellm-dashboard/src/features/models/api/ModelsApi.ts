import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import notification from "../../notifications/logic/NotificationManager";
import message from "../../notifications/logic/MessageManager";
import type {
	ModelCredential,
	ModelDeploymentRequest,
	ModelHealthResponse,
	ModelListQuery,
	ModelPage,
	ProxyModel,
	ProviderMetadata,
} from "../support/ModelModels";
const recordSchema = z.record(z.string(), z.unknown());
export const proxyModelSchema = z
	.object({
		model_name: z.string(),
		litellm_params: recordSchema.nullish().transform((value) => value ?? {}),
		model_info: recordSchema.nullish().transform((value) => value ?? {}),
	})
	.passthrough();
const pageSchema = z
	.object({
		data: z.array(proxyModelSchema),
		total_count: z.number().default(0),
		current_page: z.number().default(1),
		total_pages: z.number().default(1),
		size: z.number().default(50),
	})
	.passthrough();
const credentialSchema = z
	.object({ credential_name: z.string(), credential_values: recordSchema.default({}), credential_info: recordSchema.default({}) })
	.passthrough();
const healthSchema = z
	.object({
		healthy_count: z.number(),
		unhealthy_count: z.number(),
		healthy_endpoints: z.array(recordSchema).optional(),
		unhealthy_endpoints: z.array(recordSchema).optional(),
	})
	.passthrough();
function write(path: string, value: Record<string, unknown>, method = "POST"): Promise<Record<string, unknown>> {
	return requestJson(path, { method, body: JSON.stringify(value) }, (payload) => recordSchema.parse(payload));
}
export async function listModels(query: ModelListQuery, signal?: AbortSignal): Promise<ModelPage> {
	const params = new URLSearchParams({ include_team_models: "true", page: String(query.page), size: String(query.size) });
	for (const name of ["search", "modelId", "teamId", "sortBy", "sortOrder"] as const) {
		const value = query[name]?.trim();
		if (value) params.set(name, value);
	}
	return requestJson("/v2/model/info?" + params, { signal }, (payload) => pageSchema.parse(payload) as ModelPage);
}
export function fetchModelInfo(id: string): Promise<ProxyModel | undefined> {
	return requestJson(
		"/v1/model/info?model_id=" + encodeURIComponent(id),
		{},
		(payload) => z.object({ data: z.array(proxyModelSchema) }).parse(payload).data[0] as ProxyModel | undefined,
	);
}
export function fetchRawModel(id: string): Promise<unknown> {
	return requestJson("/model/" + encodeURIComponent(id) + "/raw");
}
export async function createModel(value: ModelDeploymentRequest): Promise<Record<string, unknown>> {
	const result = await write("/model/new", { ...value });
	message.destroy();
	notification.success("Model " + value.model_name + " created successfully");
	return result;
}
export function patchModel(id: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
	return write("/model/" + encodeURIComponent(id) + "/update", value, "PATCH");
}
export function deleteModel(id: string): Promise<Record<string, unknown>> {
	return write("/model/delete", { id });
}
export function fetchModelCosts(): Promise<Record<string, Record<string, unknown>>> {
	return requestJson("/public/litellm_model_cost_map", {}, (payload) => z.record(z.string(), recordSchema).parse(payload));
}
export function fetchModelHub(): Promise<unknown> {
	return requestJson("/model_group/info");
}
export function fetchAvailableModels(teamId?: string, onlyGroups = false): Promise<string[]> {
	const params = new URLSearchParams({ include_model_access_groups: "True" });
	if (onlyGroups) params.set("only_model_access_groups", "True");
	else {
		params.set("return_wildcard_routes", "True");
		params.set("scope", "expand");
	}
	if (teamId) params.set("team_id", teamId);
	return requestJson("/models?" + params, {}, (payload) =>
		z
			.object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
			.parse(payload)
			.data.map((model) => model.id),
	);
}
export function fetchCredentials(): Promise<ModelCredential[]> {
	return requestJson(
		"/credentials",
		{},
		(payload) =>
			z
				.object({ credentials: z.array(credentialSchema).default([]) })
				.passthrough()
				.parse(payload).credentials,
	);
}
export function fetchCredential(name: string | null, modelId?: string): Promise<ModelCredential> {
	const path = name ? "/credentials/by_name/" + encodeURIComponent(name) : "/credentials/by_model/" + encodeURIComponent(modelId || "");
	return requestJson(path, {}, (payload) => credentialSchema.parse(payload));
}
export function saveCredential(value: Record<string, unknown>): Promise<Record<string, unknown>> {
	return write("/credentials", value);
}
export function removeCredential(name: string): Promise<unknown> {
	return requestJson("/credentials/" + encodeURIComponent(name), { method: "DELETE" });
}
export function fetchCallbacks(): Promise<Record<string, unknown>> {
	return requestJson("/get/config/callbacks", {}, (payload) => recordSchema.parse(payload));
}
export function saveModelConfiguration(value: Record<string, unknown>): Promise<Record<string, unknown>> {
	return write("/config/update", value);
}
export function fetchLatestHealth(): Promise<Record<string, unknown>> {
	return requestJson("/health/latest", {}, (payload) => recordSchema.parse(payload));
}
export function checkModelHealth(id?: string): Promise<ModelHealthResponse> {
	return requestJson("/health" + (id ? "?model_id=" + encodeURIComponent(id) : ""), {}, (payload) => healthSchema.parse(payload));
}
export function fetchGeneralSettings(): Promise<Record<string, unknown>[]> {
	return requestJson("/config/list?config_type=general_settings", {}, (payload) => z.array(recordSchema).parse(payload));
}
export function saveModelStorage(enabled: boolean): Promise<Record<string, unknown>> {
	return write("/config/field/update", { field_name: "store_model_in_db", field_value: enabled, config_type: "general_settings" });
}

export function updateCredential(name: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
	return write("/credentials/" + encodeURIComponent(name), value, "PATCH");
}
export function fetchProviderFields(): Promise<ProviderMetadata[]> {
	return requestJson("/public/providers/fields", {}, (payload) =>
		z
			.array(
				z
					.object({
						provider: z.string(),
						provider_display_name: z.string(),
						litellm_provider: z.string().optional(),
						credential_fields: z.array(
							z
								.object({
									key: z.string(),
									label: z.string(),
									placeholder: z.string().nullish(),
									tooltip: z.string().nullish(),
									required: z.boolean().optional(),
									field_type: z.string().optional(),
									options: z.array(z.string()).nullish(),
									default_value: z.string().nullish(),
								})
								.passthrough(),
						),
					})
					.passthrough(),
			)
			.parse(payload),
	);
}
export function fetchRoutableModels(): Promise<{ model_name: string; type: string }[]> {
	return requestJson(
		"/config/routable_model/options",
		{},
		(payload) => z.object({ data: z.array(z.object({ model_name: z.string(), type: z.string() }).passthrough()) }).parse(payload).data,
	);
}
export function checkModelGroupHealth(name: string): Promise<Record<string, unknown>> {
	return requestJson("/health?model=" + encodeURIComponent(name), {}, (payload) => recordSchema.parse(payload));
}
export function fetchPriceReloadStatus(): Promise<Record<string, unknown>> {
	return requestJson("/schedule/model_cost_map_reload/status", {}, (payload) => recordSchema.parse(payload));
}
export function fetchPriceSource(): Promise<Record<string, unknown>> {
	return requestJson("/model/cost_map/source", {}, (payload) => recordSchema.parse(payload));
}
export function reloadPrices(): Promise<Record<string, unknown>> {
	return write("/reload/model_cost_map", {});
}
export function schedulePriceReload(hours: number): Promise<Record<string, unknown>> {
	return write("/schedule/model_cost_map_reload?hours=" + hours, {});
}
export function cancelPriceReload(): Promise<Record<string, unknown>> {
	return requestJson("/schedule/model_cost_map_reload", { method: "DELETE" }, (payload) => recordSchema.parse(payload));
}

export function fetchManagedModels(): Promise<string[]> {
	return requestJson("/cliproxy/models", {}, (payload) =>
		z
			.object({ data: z.array(z.object({ id: z.string() }).passthrough()).default([]) })
			.parse(payload)
			.data.map((model) => model.id),
	);
}
export function fetchModelCapabilities(): Promise<Record<string, unknown>> {
	return requestJson("/builtin-capabilities", {}, (payload) => recordSchema.parse(payload));
}
export const modelsApi = {
	fetchModelCapabilities,
	fetchManagedModels,
	updateCredential,
	fetchProviderFields,
	fetchRoutableModels,
	checkModelGroupHealth,
	fetchPriceReloadStatus,
	fetchPriceSource,
	reloadPrices,
	schedulePriceReload,
	cancelPriceReload,
	listModels,
	fetchModelInfo,
	fetchRawModel,
	createModel,
	patchModel,
	deleteModel,
	fetchModelCosts,
	fetchModelHub,
	fetchAvailableModels,
	fetchCredentials,
	fetchCredential,
	saveCredential,
	removeCredential,
	fetchCallbacks,
	saveModelConfiguration,
	fetchLatestHealth,
	checkModelHealth,
	fetchGeneralSettings,
	saveModelStorage,
};
export type ModelsApi = typeof modelsApi;
