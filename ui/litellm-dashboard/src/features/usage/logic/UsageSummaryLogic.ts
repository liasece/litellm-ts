import type {
	DailyActivityResponse,
	KeyRanking,
	ModelRanking,
	ProviderRanking,
	SpendMetrics,
	UsageTeam,
	ModelActivityData,
} from "../support/UsageModels";
export function emptyMetrics(): SpendMetrics {
	return {
		spend: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
		api_requests: 0,
		successful_requests: 0,
		failed_requests: 0,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 0,
	};
}
export function addMetrics(target: SpendMetrics, source: SpendMetrics): void {
	for (const key of Object.keys(target) as (keyof SpendMetrics)[]) target[key] += source[key] || 0;
}
export function modelRankings(data: DailyActivityResponse, groups = false): ModelRanking[] {
	const map = new Map<string, SpendMetrics>();
	for (const day of data.results)
		for (const [name, item] of Object.entries(groups ? day.breakdown.model_groups : day.breakdown.models)) {
			const metrics = map.get(name) ?? emptyMetrics();
			addMetrics(metrics, item.metrics);
			map.set(name, metrics);
		}
	return [...map]
		.map(([key, m]) => ({
			key,
			spend: m.spend,
			requests: m.api_requests,
			successful_requests: m.successful_requests,
			failed_requests: m.failed_requests,
			tokens: m.total_tokens,
			metrics: m,
		}))
		.sort((a, b) => b.spend - a.spend);
}
export function providerRankings(data: DailyActivityResponse): ProviderRanking[] {
	const map = new Map<string, SpendMetrics>();
	for (const day of data.results)
		for (const [name, item] of Object.entries(day.breakdown.providers)) {
			const m = map.get(name) ?? emptyMetrics();
			addMetrics(m, item.metrics);
			map.set(name, m);
		}
	return [...map].map(([provider, m]) => ({
		provider,
		spend: m.spend,
		requests: m.api_requests,
		successful_requests: m.successful_requests,
		failed_requests: m.failed_requests,
		tokens: m.total_tokens,
		metrics: m,
	}));
}
export function keyRankings(data: DailyActivityResponse, entityTags = false): KeyRanking[] {
	const map = new Map<string, KeyRanking>();
	for (const day of data.results) {
		const tags = new Map<string, { tag: string; usage: number }[]>();
		if (entityTags)
			for (const [entity, item] of Object.entries(day.breakdown.entities))
				for (const [key, value] of Object.entries(item.api_key_breakdown)) {
					tags.set(key, [...(tags.get(key) ?? []), { tag: entity, usage: value.metrics.spend }]);
				}
		for (const [key, item] of Object.entries(day.breakdown.api_keys)) {
			const value = map.get(key) ?? {
				api_key: key,
				key_alias: item.metadata.key_alias || "-",
				tags: entityTags ? (tags.get(key) ?? []) : (item.metadata.tags ?? []),
				spend: 0,
			};
			value.spend += item.metrics.spend;
			map.set(key, value);
		}
	}
	return [...map.values()].sort((a, b) => b.spend - a.spend);
}
export function dateRangeLabel(from?: Date, to?: Date): string {
	if (!from || !to) return "";
	return (
		from.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: from.getFullYear() !== to.getFullYear() ? "numeric" : undefined,
		}) +
		" – " +
		to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
	);
}
export function formatKeyLabel(
	metadata: { key_alias: string | null; key_name?: string | null; team_id: string | null },
	key: string,
	teams: UsageTeam[],
): string {
	const label = metadata.key_alias || metadata.key_name || key.slice(0, 10) + "...";
	if (!metadata.team_id) return label;
	const alias = teams.find((t) => t.team_id === metadata.team_id)?.team_alias;
	return alias ? label + " (team: " + alias + ")" : label + " (team_id: " + metadata.team_id + ")";
}
export function overallActivity(models: Record<string, ModelActivityData>) {
	const total = {
		total_requests: 0,
		total_successful_requests: 0,
		total_prompt_tokens: 0,
		total_completion_tokens: 0,
		total_tokens: 0,
		total_spend: 0,
		total_cache_read_input_tokens: 0,
		total_cache_creation_input_tokens: 0,
	};
	const days = new Map<string, SpendMetrics>();
	for (const model of Object.values(models)) {
		total.total_requests += model.total_requests;
		total.total_successful_requests += model.total_successful_requests;
		total.total_prompt_tokens += model.prompt_tokens;
		total.total_completion_tokens += model.completion_tokens;
		total.total_tokens += model.total_tokens;
		total.total_spend += model.total_spend;
		total.total_cache_read_input_tokens += model.total_cache_read_input_tokens;
		total.total_cache_creation_input_tokens += model.total_cache_creation_input_tokens;
		for (const day of model.daily_data) {
			const m = days.get(day.date) ?? emptyMetrics();
			addMetrics(m, day.metrics);
			days.set(day.date, m);
		}
	}
	return { ...total, daily_data: [...days].map(([date, metrics]) => ({ date, metrics })).sort((a, b) => a.date.localeCompare(b.date)) };
}
