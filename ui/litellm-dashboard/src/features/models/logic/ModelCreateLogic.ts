import {
	isManagedProviderSlug,
	isSubscriptionProviderSlug,
	providerSlugFromValue,
	subscriptionModelName,
} from "../../subscriptions/logic/SubscriptionProviderLogic";
import { modelRecord, modelString, modelStrings, type ModelMapping, type ModelDeploymentRequest } from "../support/ModelModels";

export interface ModelCreateDraft extends Record<string, unknown> {
	custom_llm_provider?: string;
	model?: string | string[];
	model_mappings?: ModelMapping[];
}
export function providerSlug(provider: string): string {
	return providerSlugFromValue(provider);
}
/**
 * Canonical deployment model name.
 *
 * Subscription providers use `<slug>/<upstreamId>` so the runtime can route the
 * request to the account source; legacy Azure and CLIProxy keep their prefixes.
 */
export function providerModelName(model: string, provider: string): string {
	const slug = providerSlugFromValue(provider);
	// Azure deployments are stored as `azure/<deployment>` even though the catalog
	// value is the catalog key; accept both spellings.
	if (provider === "Azure" || slug === "azure") return "azure/" + model;
	if (isSubscriptionProviderSlug(slug)) return subscriptionModelName(slug, model);
	return isManagedProviderSlug(slug) ? slug + "/" + model : model;
}
export function selectedModelMappings(models: string | string[] | undefined, provider: string, customName = ""): ModelMapping[] {
	const values = typeof models === "string" ? [models] : (models ?? []);
	if (values.includes("all-wildcard")) return [];
	return values.map((model) => {
		const name = model === "custom" && customName ? customName : model;
		return { public_name: name, litellm_model: providerModelName(name, provider) };
	});
}
/**
 * Convert displayed USD / 1M token prices once; each deployment receives the same per-token price.
 * `resolveProvider` lets the form resolve the selected catalog entry to its canonical slug.
 */
export function prepareModelCreate(
	source: ModelCreateDraft,
	resolveProvider: (value: string) => string = providerSlug,
): ModelDeploymentRequest[] {
	const values: ModelCreateDraft = { ...source };
	const mappings = (values.model_mappings ?? []).map((mapping) => ({ ...mapping }));
	delete values.model_mappings;
	const selected = typeof values.model === "string" ? [values.model] : (values.model ?? []);
	if (selected.includes("all-wildcard")) {
		const name = resolveProvider(values.custom_llm_provider ?? "") + "/*";
		values.model_name = name;
		values.model = name;
		mappings.push({ public_name: name, litellm_model: name });
	}
	for (const key of ["input_cost_per_token", "output_cost_per_token"]) {
		if (values[key] !== undefined && values[key] !== null && values[key] !== "") values[key] = Number(values[key]) / 1_000_000;
	}
	return mappings.map((mapping) => {
		const params: Record<string, unknown> = { model: mapping.litellm_model };
		const info: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined || value === "" || ["custom_pricing", "pricing_model", "cache_control"].includes(key)) continue;
			if (key === "model") continue;
			if (key === "model_name" || key === "custom_model_name") params.model = value;
			else if (key === "custom_llm_provider") params.custom_llm_provider = resolveProvider(modelString(value));
			else if (["base_model", "team_id", "mode"].includes(key)) info[key] = value;
			else if (key === "model_access_group") info.access_groups = value;
			else if (key === "litellm_extra_params" && value) {
				const extra = modelRecord(JSON.parse(modelString(value)));
				delete extra.litellm_credential_name;
				Object.assign(params, extra);
			} else if (key === "model_info_params" && value) Object.assign(info, modelRecord(JSON.parse(modelString(value))));
			else if (["input_cost_per_token", "output_cost_per_token", "input_cost_per_second"].includes(key)) {
				if (value !== undefined && value !== null) params[key] = Number(value);
			} else params[key] = value;
		}
		// Managed providers resolve credentials from the account store; deployments must
		// not carry a provider key or api_base of their own.
		if (isManagedProviderSlug(params.custom_llm_provider))
			for (const key of ["litellm_credential_name", "credential_name", "api_base", "api_key"]) delete params[key];
		// Subscription models must stay canonical `<slug>/<upstreamId>` even when a custom
		// model name was typed or a wildcard reset left a bare name behind.
		if (isSubscriptionProviderSlug(params.custom_llm_provider) && modelString(params.model))
			params.model = subscriptionModelName(modelString(params.custom_llm_provider), modelString(params.model));
		return { model_name: mapping.public_name, litellm_params: params, model_info: info };
	});
}
export function validateModelCreate(
	values: ModelCreateDraft,
	providerFields: { key: string; required?: boolean }[],
	teamRequired: boolean,
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!values.custom_llm_provider) errors.custom_llm_provider = "Required";
	const models = typeof values.model === "string" ? (values.model ? [values.model] : []) : modelStrings(values.model);
	if (!models.length)
		errors.model = values.custom_llm_provider === "Azure" ? "Please enter a deployment name." : "Please enter at least one model.";
	if (models.includes("custom") && !values.custom_model_name) errors.custom_model_name = "Please enter a custom model name.";
	if (
		!models.includes("all-wildcard") &&
		(!values.model_mappings?.length || values.model_mappings.some((mapping) => !mapping.public_name.trim()))
	)
		errors.model_mappings = values.model_mappings?.length
			? "All model mappings must have valid public names"
			: "At least one model mapping is required";
	if (teamRequired && !values.team_id) errors.team_id = "Please select a team";
	const managedProvider = isManagedProviderSlug(providerSlug(values.custom_llm_provider ?? ""));
	if (!values.litellm_credential_name && !managedProvider)
		for (const field of providerFields) if (field.required && !values[field.key]) errors[field.key] = "Required";
	for (const name of ["litellm_extra_params", "model_info_params"]) {
		if (!values[name]) continue;
		try {
			JSON.parse(modelString(values[name]));
		} catch {
			errors[name] = "Invalid JSON";
		}
	}
	for (const name of ["input_cost_per_token", "output_cost_per_token", "input_cost_per_second"]) {
		if (values[name] && (Number.isNaN(Number(values[name])) || Number(values[name]) < 0))
			errors[name] = "Please enter a valid positive number";
	}
	return errors;
}
