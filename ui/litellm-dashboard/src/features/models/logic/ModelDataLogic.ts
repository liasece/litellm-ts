import type { DisplayProxyModel, ProxyModel } from "../support/ModelModels";
import { modelRecord, modelString } from "../support/ModelModels";
export function transformModels(rows: readonly ProxyModel[], costs: Record<string, Record<string, unknown>>): DisplayProxyModel[] {
	return rows.map((source) => {
		const model: ProxyModel = { ...source, litellm_params: { ...source.litellm_params }, model_info: { ...source.model_info } };
		const name = modelString(model.litellm_params.model) || null;
		const custom = modelString(model.litellm_params.custom_llm_provider);
		const pieces = name?.split("/") ?? [];
		const provider = name ? custom || (pieces.length === 1 ? modelString(costs[name]?.litellm_provider) || "openai" : pieces[0]) : "-";
		const perMillion = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value) * 1_000_000);
		return {
			...model,
			provider,
			litellm_model_name: name,
			input_cost: perMillion(model.model_info.input_cost_per_token),
			output_cost: perMillion(model.model_info.output_cost_per_token),
			cache_read_input_cost: perMillion(model.model_info.cache_read_input_token_cost),
			max_tokens: model.model_info.max_tokens,
			max_input_tokens: model.model_info.max_input_tokens,
			api_base: model.litellm_params.api_base,
			cleanedLitellmParams: Object.fromEntries(
				Object.entries(model.litellm_params).filter(([name]) => name !== "model" && name !== "api_base"),
			),
		};
	});
}
export function deploymentIconProps(model: DisplayProxyModel) {
	return {
		model: modelString(model.litellm_params.model) || model.litellm_model_name || model.model_name,
		provider: modelString(model.litellm_params.custom_llm_provider) || model.provider,
		baseModel: modelString(model.model_info.base_model) || modelString(model.litellm_params.base_model),
	};
}
export function modelDisplayName(model: ProxyModel): string {
	const info = modelRecord(model.model_info);
	return modelString(info.team_public_model_name) || model.model_name || "-";
}
export function modelPriceIdentity(model: ProxyModel) {
	return { model_id: model.model_info.id ?? undefined, model_name: model.model_name };
}

/** ModelInfoView normalizes raw detail rows without enriching its overview from the list projection. */
export function normalizeModelDetails(source: ProxyModel): DisplayProxyModel {
	const numeric = (value: unknown): number | null => (value == null ? null : Number(value));
	return {
		...source,
		litellm_params: { ...source.litellm_params },
		model_info: { ...source.model_info },
		provider: modelString(source.provider) || modelString(source.litellm_params.custom_llm_provider),
		litellm_model_name:
			modelString(source.litellm_model_name) ||
			modelString(source.litellm_params.litellm_model_name) ||
			modelString(source.litellm_params.model) ||
			modelString(source.model_info.key) ||
			null,
		input_cost: numeric(source.input_cost),
		output_cost: numeric(source.output_cost),
		cache_read_input_cost: numeric(source.cache_read_input_cost),
		api_base: source.api_base,
		cleanedLitellmParams: modelRecord(source.cleanedLitellmParams),
		max_tokens: source.max_tokens,
		max_input_tokens: source.max_input_tokens,
	};
}
