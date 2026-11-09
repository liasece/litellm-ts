import { modelRecord, modelString, modelStrings, type ProxyModel, type ModelDeploymentRequest } from "../support/ModelModels";
import {
	isManagedProviderSlug,
	isSubscriptionProviderSlug,
	providerSlugFromValue,
	subscriptionModelName,
} from "../../subscriptions/logic/SubscriptionProviderLogic";
export type ModelEditDraft = Record<string, unknown>;
export function createModelEditDraft(model: ProxyModel): ModelEditDraft {
	const params = model.litellm_params,
		info = model.model_info;
	const cost = (name: string) => {
		const value = params[name] ?? info[name];
		return value == null ? null : Number(value) * 1_000_000;
	};
	return {
		model_name: model.model_name,
		litellm_model_name: params.litellm_model_name ?? params.model ?? info.key ?? null,
		override_model_name: info.override_model_name ?? undefined,
		override_reasoning_effort: info.override_reasoning_effort ?? undefined,
		api_base: params.api_base,
		custom_llm_provider: params.custom_llm_provider,
		organization: params.organization,
		tpm: params.tpm,
		rpm: params.rpm,
		max_retries: params.max_retries,
		timeout: params.timeout,
		stream_timeout: params.stream_timeout,
		input_cost: cost("input_cost_per_token"),
		output_cost: cost("output_cost_per_token"),
		cache_control: Boolean(params.cache_control_injection_points),
		cache_control_injection_points: params.cache_control_injection_points || [],
		model_access_group: modelStrings(info.access_groups),
		enabled_builtin_capabilities: modelStrings(info.enabled_builtin_capabilities),
		guardrails: modelStrings(params.guardrails),
		vector_store_ids: modelStrings(params.vector_store_ids),
		health_check_model: modelString(params.model).includes("*") ? info.health_check_model : undefined,
		litellm_credential_name: params.litellm_credential_name || "",
		api_key: params.api_key ?? "",
		delete_api_key: false,
		model_info: JSON.stringify(info, null, 2),
		litellm_extra_params: JSON.stringify(
			Object.fromEntries(Object.entries(params).filter(([key]) => !["api_key", "litellm_credential_name"].includes(key))),
			null,
			2,
		),
	};
}
export function prepareModelUpdate(values: ModelEditDraft, current: ProxyModel): ModelDeploymentRequest {
	let extra: Record<string, unknown>;
	try {
		extra = modelRecord(values.litellm_extra_params ? JSON.parse(modelString(values.litellm_extra_params)) : {});
	} catch {
		throw new Error("Invalid JSON in LiteLLM Params");
	}
	delete extra.litellm_credential_name;
	delete extra.api_key;
	const params: Record<string, unknown> = {
		...modelRecord(values.litellm_params),
		...extra,
		model: values.litellm_model_name,
		api_base: values.api_base,
		custom_llm_provider: values.custom_llm_provider,
		organization: values.organization,
		tpm: values.tpm,
		rpm: values.rpm,
		max_retries: values.max_retries,
		timeout: values.timeout,
		stream_timeout: values.stream_timeout,
		input_cost_per_token: Number(values.input_cost) / 1_000_000,
		output_cost_per_token: Number(values.output_cost) / 1_000_000,
	};
	const credential = modelString(values.litellm_credential_name),
		replacement = typeof values.api_key === "string" ? values.api_key.trim() : "";
	const provider = providerSlugFromValue(values.custom_llm_provider ?? current.litellm_params.custom_llm_provider ?? "");
	if (isManagedProviderSlug(provider)) {
		// Managed providers own their transport credentials; keep them out of the deployment.
		params.api_base = null;
		params.api_key = null;
		params.litellm_credential_name = null;
		params.custom_llm_provider = provider;
		if (isSubscriptionProviderSlug(provider) && modelString(params.model)) {
			const previous = current.litellm_params;
			if (
				modelString(previous.model).startsWith("cliproxy/") &&
				params.model === previous.model &&
				provider === providerSlugFromValue(previous.custom_llm_provider ?? "")
			) {
				// The model API projects a subscription onto this stored legacy deployment.
				// PATCH merges omitted fields from storage, preserving its routing and billing identity.
				delete params.model;
				delete params.custom_llm_provider;
			} else {
				params.model = subscriptionModelName(provider, modelString(params.model));
			}
		}
	} else if (credential) {
		params.litellm_credential_name = credential;
		params.api_key = null;
	} else {
		params.litellm_credential_name = null;
		if (values.delete_api_key) params.api_key = null;
		else if (replacement) params.api_key = replacement;
		else if (current.litellm_params.litellm_credential_name)
			throw new Error("Enter a new API key before switching to Manual credentials");
		else delete params.api_key;
	}
	if (values.guardrails) params.guardrails = values.guardrails;
	if (values.vector_store_ids !== undefined)
		params.vector_store_ids = Array.isArray(values.vector_store_ids) ? values.vector_store_ids : [];
	if (values.cache_control && Array.isArray(values.cache_control_injection_points) && values.cache_control_injection_points.length)
		params.cache_control_injection_points = values.cache_control_injection_points;
	else delete params.cache_control_injection_points;
	let info: Record<string, unknown>;
	try {
		info = values.model_info ? modelRecord(JSON.parse(modelString(values.model_info))) : { ...current.model_info };
	} catch {
		throw new Error("Invalid JSON in Model Info");
	}
	if (values.model_access_group) info = { ...info, access_groups: values.model_access_group };
	if (values.health_check_model !== undefined) info.health_check_model = values.health_check_model;
	info = {
		...info,
		override_model_name: values.override_model_name || null,
		override_reasoning_effort: values.override_reasoning_effort || null,
		enabled_builtin_capabilities: Array.isArray(values.enabled_builtin_capabilities) ? values.enabled_builtin_capabilities : [],
	};
	return { model_name: modelString(values.model_name), litellm_params: params, model_info: info };
}
export function mergeModelUpdate(current: ProxyModel, response: Record<string, unknown>, payload: ModelDeploymentRequest): ProxyModel {
	const data = Array.isArray(response.data) ? response.data[0] : (response.data ?? response.model ?? response);
	const returned = modelRecord(data);
	if (!Object.keys(returned).length) return { ...current, ...payload, model_info: { ...current.model_info, ...payload.model_info } };
	return {
		...current,
		...returned,
		model_name: modelString(returned.model_name) || current.model_name,
		litellm_params: { ...current.litellm_params, ...modelRecord(returned.litellm_params) },
		model_info: { ...current.model_info, ...modelRecord(returned.model_info) },
	};
}
export function isCodexReasoningModel(provider: unknown, model: unknown): boolean {
	const name = modelString(model)
			.toLowerCase()
			.replace(/^cliproxy\//, ""),
		slug = modelString(provider).toLowerCase();
	if (slug === "anthropic" || name.includes("claude")) return false;
	return slug === "openai" || slug === "cliproxy" || name.includes("codex") || name.startsWith("gpt-") || /^o\d/.test(name);
}
export interface ModelBasicField {
	key: string;
	label: string;
	editLabel?: string;
	kind: string;
	source?: string;
	tooltip?: string;
	placeholder?: string;
}
export const basicModelFields: readonly ModelBasicField[] = [
	{ key: "model_name", label: "Model Name", kind: "suggestion", source: "model_name" },
	{ key: "litellm_model_name", label: "LiteLLM Model Name", kind: "suggestion", source: "model" },
	{
		key: "override_model_name",
		label: "Model Override",
		kind: "override",
		tooltip:
			"Always route requests for this model to the selected target first, then fall back along the chain configured on that target.",
	},
	{
		key: "override_reasoning_effort",
		label: "Override Reasoning Effort",
		kind: "effort",
		tooltip: "When set, replaces the caller's reasoning effort on the final request sent to the model server.",
	},
	{
		key: "input_cost",
		placeholder: "Enter input cost",
		label: "Input Cost (per 1M tokens)",
		editLabel: "Input Cost (USD / 1M tokens)",
		kind: "number",
		source: "input_cost_per_token",
	},
	{
		key: "output_cost",
		placeholder: "Enter output cost",
		label: "Output Cost (per 1M tokens)",
		editLabel: "Output Cost (USD / 1M tokens)",
		kind: "number",
		source: "output_cost_per_token",
	},
	{ key: "api_base", placeholder: "Enter API base", label: "API Base", kind: "text", source: "api_base" },
	{ key: "custom_llm_provider", label: "Custom LLM Provider", kind: "provider", source: "custom_llm_provider" },
	{ key: "organization", placeholder: "Enter organization", label: "Organization", kind: "text", source: "organization" },
	{ key: "tpm", placeholder: "Enter TPM", label: "TPM (Tokens per Minute)", kind: "number", source: "tpm" },
	{ key: "rpm", placeholder: "Enter RPM", label: "RPM (Requests per Minute)", kind: "number", source: "rpm" },
	{ key: "max_retries", placeholder: "Enter max retries", label: "Max Retries", kind: "number", source: "max_retries" },
	{ key: "timeout", placeholder: "Enter timeout", label: "Timeout (seconds)", kind: "number", source: "timeout" },
	{
		key: "stream_timeout",
		placeholder: "Enter stream timeout",
		label: "Stream Timeout (seconds)",
		kind: "number",
		source: "stream_timeout",
	},
];
