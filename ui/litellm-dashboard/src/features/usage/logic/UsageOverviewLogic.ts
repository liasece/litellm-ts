import type {
	KeyMetadata,
	KeyRanking,
	ModelActivityData,
	ModelRanking,
	ProviderRanking,
	SpendMetrics,
	TopApiKeyData,
	TopModelData,
	UsageDetailItem,
	UsageDetailResponse,
	UsageDimensionItem,
	UsageMetadata,
	UsageSummaryResponse,
	UsageTeam,
} from "../support/UsageModels";
import { formatKeyLabel } from "./UsageSummaryLogic";

/**
 * 空 metadata 让 Cost 页在 summary 尚未返回时保持稳定的模板形状；页面本身仍会显示加载态。
 */
export function emptyUsageMetadata(): UsageMetadata {
	return {
		total_spend: 0,
		total_prompt_tokens: 0,
		total_completion_tokens: 0,
		total_tokens: 0,
		total_api_requests: 0,
		total_successful_requests: 0,
		total_failed_requests: 0,
		total_cache_read_input_tokens: 0,
		total_cache_creation_input_tokens: 0,
		total_pages: 1,
		has_more: false,
		page: 1,
	};
}

function rankingFromDimension(items: UsageDimensionItem[]): ModelRanking[] {
	return items
		.map((item) => ({
			key: item.key,
			spend: item.metrics.spend,
			requests: item.metrics.api_requests,
			successful_requests: item.metrics.successful_requests,
			failed_requests: item.metrics.failed_requests,
			tokens: item.metrics.total_tokens,
			metrics: item.metrics,
		}))
		.sort((a, b) => b.spend - a.spend);
}

/**
 * summary 已由服务端按维度汇总，这里只转换为现有图表组件需要的扁平排名，避免再次遍历全量嵌套 breakdown。
 * @param summary - Usage summary 响应
 * @param groups - true 时使用 model_groups 维度
 */
export function summaryModelRankings(summary: UsageSummaryResponse | null, groups = false): ModelRanking[] {
	if (!summary) return [];
	return rankingFromDimension(groups ? summary.dimensions.model_groups : summary.dimensions.models);
}

export function summaryProviderRankings(summary: UsageSummaryResponse | null): ProviderRanking[] {
	if (!summary) return [];
	return summary.dimensions.providers
		.map((item) => ({
			provider: item.key,
			spend: item.metrics.spend,
			requests: item.metrics.api_requests,
			successful_requests: item.metrics.successful_requests,
			failed_requests: item.metrics.failed_requests,
			tokens: item.metrics.total_tokens,
			metrics: item.metrics,
		}))
		.sort((a, b) => b.spend - a.spend);
}

export function summaryKeyRankings(summary: UsageSummaryResponse | null): KeyRanking[] {
	if (!summary) return [];
	return summary.dimensions.api_keys
		.map((item) => {
			const metadata = (item.metadata ?? {}) as Partial<KeyMetadata>;
			return {
				api_key: item.key,
				key_alias: metadata.key_alias || "-",
				tags: metadata.tags ?? [],
				spend: item.metrics.spend,
			};
		})
		.sort((a, b) => b.spend - a.spend);
}

function topApiKey(item: UsageDimensionItem): TopApiKeyData {
	const metadata = (item.metadata ?? {}) as Partial<KeyMetadata>;
	return {
		api_key: item.key,
		key_alias: metadata.key_alias ?? null,
		key_name: metadata.key_name ?? null,
		team_id: metadata.team_id ?? null,
		spend: item.metrics.spend,
		requests: item.metrics.api_requests,
		tokens: item.metrics.total_tokens,
	};
}

function topModel(item: UsageDimensionItem): TopModelData {
	return {
		model: item.key,
		spend: item.metrics.spend,
		requests: item.metrics.api_requests,
		successful_requests: item.metrics.successful_requests,
		failed_requests: item.metrics.failed_requests,
		tokens: item.metrics.total_tokens,
		metrics: item.metrics,
	};
}

function activityItem(item: UsageDetailItem, teams: UsageTeam[], keys: boolean): ModelActivityData {
	const metadata = (item.metadata ?? {}) as Partial<KeyMetadata>;
	const keyMetadata = {
		key_alias: metadata.key_alias ?? null,
		key_name: metadata.key_name ?? null,
		team_id: metadata.team_id ?? null,
	};
	return {
		label: keys ? formatKeyLabel(keyMetadata, item.key, teams) : item.key,
		total_requests: item.metrics.api_requests,
		total_successful_requests: item.metrics.successful_requests,
		total_failed_requests: item.metrics.failed_requests,
		total_cache_read_input_tokens: item.metrics.cache_read_input_tokens,
		total_cache_creation_input_tokens: item.metrics.cache_creation_input_tokens,
		total_tokens: item.metrics.total_tokens,
		prompt_tokens: item.metrics.prompt_tokens,
		completion_tokens: item.metrics.completion_tokens,
		total_spend: item.metrics.spend,
		top_api_keys: (item.top_api_keys ?? []).map(topApiKey),
		top_models: (item.top_models ?? []).map(topModel),
		daily_data: item.daily,
	};
}

/**
 * 把分页 detail 项转换为 Model/Key/MCP Activity 组件使用的 Map。
 * @param detail - 当前维度的 detail 响应
 * @param teams - 团队别名，用于 Key 展示
 * @param keys - 当前维度是否为 API Key
 */
export function detailActivity(detail: UsageDetailResponse | null, teams: UsageTeam[], keys: boolean): Record<string, ModelActivityData> {
	if (!detail) return {};
	const result: Record<string, ModelActivityData> = {};
	for (const item of detail.items) result[item.key] = activityItem(item, teams, keys);
	return result;
}

export interface ActivityOverall {
	total_requests: number;
	total_successful_requests: number;
	total_prompt_tokens: number;
	total_completion_tokens: number;
	total_tokens: number;
	total_spend: number;
	total_cache_read_input_tokens: number;
	total_cache_creation_input_tokens: number;
	daily_data: { date: string; metrics: SpendMetrics }[];
}

/** Activity 顶部的 Overall 必须覆盖全量 summary，不能只汇总当前分页已加载的实体。 */
export function summaryOverall(summary: UsageSummaryResponse | null): ActivityOverall | null {
	if (!summary) return null;
	return {
		total_requests: summary.metadata.total_api_requests,
		total_successful_requests: summary.metadata.total_successful_requests,
		total_prompt_tokens: summary.metadata.total_prompt_tokens,
		total_completion_tokens: summary.metadata.total_completion_tokens,
		total_tokens: summary.metadata.total_tokens,
		total_spend: summary.metadata.total_spend,
		total_cache_read_input_tokens: summary.metadata.total_cache_read_input_tokens,
		total_cache_creation_input_tokens: summary.metadata.total_cache_creation_input_tokens,
		daily_data: [...summary.results].sort((left, right) => left.date.localeCompare(right.date)),
	};
}

export function metricsFromDetail(detail: UsageDetailResponse | null): SpendMetrics[] {
	return detail?.items.map((item) => item.metrics) ?? [];
}
