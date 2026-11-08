import { requestJson } from "../../platform/api/HttpApiClient";
import { modelsApi } from "../api/ModelsApi";
import { emptyModelCatalog, modelRecord, modelString, type ModelCatalog, type ProviderMetadata } from "../support/ModelModels";
import type { KeyTeam } from "../../virtual-keys/support/VirtualKeyModels";
let providerCache: { at: number; value: ProviderMetadata[] } | null = null;
export async function loadProviderFields(): Promise<ProviderMetadata[]> {
	if (providerCache && Date.now() - providerCache.at < 86400000) return providerCache.value;
	const value = await modelsApi.fetchProviderFields();
	providerCache = { at: Date.now(), value };
	return value;
}
function records(value: unknown, key: string): Record<string, unknown>[] {
	const values = Array.isArray(value) ? value : modelRecord(value)[key];
	return Array.isArray(values) ? values.map(modelRecord) : [];
}
export async function loadModelCatalog(): Promise<ModelCatalog> {
	const result = emptyModelCatalog();
	const keys = [
		"costs",
		"credentials",
		"models",
		"accessGroups",
		"hub",
		"router",
		"providerFields",
		"uiSettings",
		"teams",
		"guardrails",
		"tags",
		"vectorStores",
	] as const;
	const loaded = await Promise.allSettled([
		modelsApi.fetchModelCosts(),
		modelsApi.fetchCredentials(),
		modelsApi.fetchAvailableModels(),
		modelsApi.fetchAvailableModels(undefined, true),
		modelsApi.fetchModelHub(),
		modelsApi.fetchCallbacks(),
		loadProviderFields(),
		requestJson("/get/ui_settings"),
		requestJson("/team/list"),
		requestJson("/v2/guardrails/list"),
		requestJson("/tag/list"),
		requestJson("/vector_store/list"),
	]);
	for (let index = 0; index < loaded.length; index++) {
		const outcome = loaded[index],
			key = keys[index];
		if (outcome.status === "rejected") {
			if (key === "providerFields")
				result.providerError =
					outcome.reason instanceof Error ? outcome.reason.message : "Failed to load provider credential fields";
			continue;
		}
		const value = outcome.value;
		if (key === "costs") result.costs = value as ModelCatalog["costs"];
		else if (key === "credentials") result.credentials = value as ModelCatalog["credentials"];
		else if (key === "models" || key === "accessGroups") result[key] = value as string[];
		else if (key === "providerFields") result.providerFields = value as ProviderMetadata[];
		else if (key === "uiSettings") result.uiSettings = modelRecord(modelRecord(value).values);
		else if (key === "teams") result.teams = records(value, "teams").filter((team) => typeof team.team_id === "string") as KeyTeam[];
		else if (key === "hub") result.hub = records(value, "data");
		else if (key === "router") result.router = modelRecord(modelRecord(value).router_settings);
		else if (key === "guardrails")
			result.guardrails = records(value, "guardrails")
				.filter((item) => item.guardrail_name)
				.map((item) => ({ value: modelString(item.guardrail_name), label: modelString(item.guardrail_name) }));
		else if (key === "tags")
			result.tags = records(value, "tags").map((item) => ({ value: modelString(item.name), label: modelString(item.name) }));
		else if (key === "vectorStores")
			result.vectorStores = records(value, "data").map((item) => ({
				value: modelString(item.vector_store_id),
				label: modelString(item.vector_store_name) + " (" + modelString(item.vector_store_id) + ")",
			}));
	}
	return result;
}
