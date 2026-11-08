import type {
	DailyData,
	KeyMetricWithMetadata,
	MetricWithMetadata,
	ModelActivityData,
	TopApiKeyData,
	TopModelData,
	UsageTeam,
} from "../support/UsageModels";
import { formatKeyLabel } from "./UsageSummaryLogic";
export const processActivityData = (
	dailyActivity: { results: DailyData[] },
	key: "models" | "api_keys" | "mcp_servers" | "entities",
	teams: UsageTeam[] = [],
): Record<string, ModelActivityData> => {
	const modelMetrics: Record<string, ModelActivityData> = Object.create(null);

	dailyActivity.results.forEach((day) => {
		Object.entries(day.breakdown[key] || {}).forEach(([model, modelData]) => {
			if (!modelMetrics[model]) {
				modelMetrics[model] = {
					label:
						key === "api_keys"
							? formatKeyLabel((modelData as KeyMetricWithMetadata).metadata, model, teams)
							: key === "entities"
								? String(
										(modelData as MetricWithMetadata).metadata?.agent_name ||
											(modelData as MetricWithMetadata).metadata?.team_alias ||
											model,
									)
								: model,
					total_requests: 0,
					total_successful_requests: 0,
					total_failed_requests: 0,
					total_tokens: 0,
					prompt_tokens: 0,
					completion_tokens: 0,
					total_spend: 0,
					total_cache_read_input_tokens: 0,
					total_cache_creation_input_tokens: 0,
					top_api_keys: [],
					top_models: [],
					daily_data: [],
				};
			}
			// Update totals
			modelMetrics[model].total_requests += modelData.metrics.api_requests;
			modelMetrics[model].prompt_tokens += modelData.metrics.prompt_tokens;
			modelMetrics[model].completion_tokens += modelData.metrics.completion_tokens;
			modelMetrics[model].total_tokens += modelData.metrics.total_tokens;
			modelMetrics[model].total_spend += modelData.metrics.spend;
			modelMetrics[model].total_successful_requests += modelData.metrics.successful_requests;
			modelMetrics[model].total_failed_requests += modelData.metrics.failed_requests;
			modelMetrics[model].total_cache_read_input_tokens += modelData.metrics.cache_read_input_tokens || 0;
			modelMetrics[model].total_cache_creation_input_tokens += modelData.metrics.cache_creation_input_tokens || 0;

			// Add daily data
			modelMetrics[model].daily_data.push({
				date: day.date,
				metrics: {
					prompt_tokens: modelData.metrics.prompt_tokens,
					completion_tokens: modelData.metrics.completion_tokens,
					total_tokens: modelData.metrics.total_tokens,
					api_requests: modelData.metrics.api_requests,
					spend: modelData.metrics.spend,
					successful_requests: modelData.metrics.successful_requests,
					failed_requests: modelData.metrics.failed_requests,
					cache_read_input_tokens: modelData.metrics.cache_read_input_tokens || 0,
					cache_creation_input_tokens: modelData.metrics.cache_creation_input_tokens || 0,
				},
			});
		});
	});

	// Process Virtual Key breakdowns for each metric (skip if key is 'api_keys' to avoid duplication)
	if (key !== "api_keys") {
		Object.entries(modelMetrics).forEach(([model]) => {
			const apiKeyBreakdown: Record<string, TopApiKeyData> = Object.create(null);

			// Aggregate Virtual Key data across all days
			dailyActivity.results.forEach((day) => {
				const modelData = day.breakdown[key]?.[model];
				if (modelData && "api_key_breakdown" in modelData) {
					Object.entries(modelData.api_key_breakdown || {}).forEach(([apiKey, keyData]) => {
						if (!apiKeyBreakdown[apiKey]) {
							apiKeyBreakdown[apiKey] = {
								api_key: apiKey,
								key_alias: keyData.metadata.key_alias,
								key_name: keyData.metadata.key_name,
								team_id: keyData.metadata.team_id,
								spend: 0,
								requests: 0,
								tokens: 0,
							};
						}

						apiKeyBreakdown[apiKey].spend += keyData.metrics.spend;
						apiKeyBreakdown[apiKey].requests += keyData.metrics.api_requests;
						apiKeyBreakdown[apiKey].tokens += keyData.metrics.total_tokens;
					});
				}
			});

			modelMetrics[model].top_api_keys = Object.values(apiKeyBreakdown).sort((a, b) => b.spend - a.spend);
		});
	}

	// Process Model breakdowns for each API key (only when key is 'api_keys')
	if (key === "api_keys") {
		Object.entries(modelMetrics).forEach(([apiKeyHash]) => {
			const modelBreakdown: Record<string, TopModelData> = Object.create(null);

			// Aggregate Model data for this key across all days
			// We need to look in breakdown.models[model].api_key_breakdown[apiKeyHash]
			dailyActivity.results.forEach((day) => {
				Object.entries(day.breakdown.models || {}).forEach(([modelName, modelData]) => {
					if (modelData && "api_key_breakdown" in modelData) {
						const keyDataForModel = modelData.api_key_breakdown?.[apiKeyHash];
						if (keyDataForModel) {
							if (!modelBreakdown[modelName]) {
								modelBreakdown[modelName] = {
									model: modelName,
									spend: 0,
									requests: 0,
									successful_requests: 0,
									failed_requests: 0,
									tokens: 0,
								};
							}

							modelBreakdown[modelName].spend += keyDataForModel.metrics.spend;
							modelBreakdown[modelName].requests += keyDataForModel.metrics.api_requests;
							modelBreakdown[modelName].successful_requests += keyDataForModel.metrics.successful_requests || 0;
							modelBreakdown[modelName].failed_requests += keyDataForModel.metrics.failed_requests || 0;
							modelBreakdown[modelName].tokens += keyDataForModel.metrics.total_tokens;
						}
					}
				});
			});

			// Sort by spend
			modelMetrics[apiKeyHash].top_models = Object.values(modelBreakdown).sort((a, b) => b.spend - a.spend);
		});
	}

	// Sort daily data
	Object.values(modelMetrics).forEach((metrics) => {
		metrics.daily_data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	});

	return modelMetrics;
};
