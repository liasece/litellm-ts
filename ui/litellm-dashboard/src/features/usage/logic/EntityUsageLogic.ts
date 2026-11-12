import type { DailyActivityResponse, EntityOption, ModelRanking, SpendMetrics } from "../support/UsageModels";
import { addMetrics, emptyMetrics } from "./UsageSummaryLogic";
export function entityLabel(id: string, metadata: Record<string, unknown>, options: EntityOption[]): string {
	return options.find((item) => item.value === id)?.label || String(metadata.team_alias || id);
}
export function entityBreakdown(data: DailyActivityResponse, options: EntityOption[], selected: string[]) {
	const values = new Map<string, { metrics: SpendMetrics; metadata: { id: string; alias: string; alias_display: string } }>();
	for (const day of data.results)
		for (const [id, item] of Object.entries(day.breakdown.entities)) {
			const alias = entityLabel(id, item.metadata, options),
				value = values.get(id) ?? {
					metrics: emptyMetrics(),
					metadata: { id, alias, alias_display: alias.length > 15 ? alias.slice(0, 15) + "..." : alias },
				};
			// The visible entity overview uses the entity totals, never summed model totals.
			addMetrics(value.metrics, item.metrics);
			values.set(id, value);
		}
	return [...values.values()]
		.sort((a, b) => b.metrics.spend - a.metrics.spend)
		.filter((v) => !selected.length || selected.includes(v.metadata.id));
}
export function agentRankings(data: DailyActivityResponse): ModelRanking[] {
	const map = new Map<string, { metrics: SpendMetrics; name: string }>();
	for (const day of data.results)
		for (const [id, item] of Object.entries(day.breakdown.entities)) {
			const value = map.get(id) ?? { metrics: emptyMetrics(), name: String(item.metadata.agent_name || id) };
			addMetrics(value.metrics, item.metrics);
			map.set(id, value);
		}
	return [...map.values()]
		.map(({ name, metrics: m }) => ({
			key: name,
			spend: m.spend,
			requests: m.api_requests,
			successful_requests: m.successful_requests,
			failed_requests: m.failed_requests,
			tokens: m.total_tokens,
			metrics: m,
		}))
		.sort((a, b) => b.spend - a.spend);
}
