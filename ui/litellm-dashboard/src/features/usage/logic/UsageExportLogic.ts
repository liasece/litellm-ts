import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { emptyMetrics, addMetrics } from "./UsageSummaryLogic";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import type { BreakdownMetrics, DailyActivityResponse, EntityType, KeyMetricWithMetadata, SpendMetrics } from "../support/UsageModels";
import type { ExportRow, ExportScope, EntityDictionary, EntityBreakdown } from "../support/UsageExportModels";
function teamId(keys: Record<string, KeyMetricWithMetadata>): string | null {
	for (const key of Object.values(keys)) if (key.metadata.team_id) return key.metadata.team_id;
	return null;
}
export function resolveEntities(breakdown: BreakdownMetrics): EntityDictionary {
	if (Object.keys(breakdown.entities).length) return breakdown.entities;
	const grouped: EntityDictionary = Object.create(null);
	for (const [id, key] of Object.entries(breakdown.api_keys)) {
		const team = key.metadata.team_id || "Unassigned";
		if (!Object.hasOwn(grouped, team))
			grouped[team] = { metrics: emptyMetrics(), metadata: {}, api_key_breakdown: Object.create(null) };
		addMetrics(grouped[team].metrics, key.metrics);
		grouped[team].api_key_breakdown[id] = key;
	}
	return grouped;
}
function alias(map: Record<string, string>, id: string | null) {
	return id && Object.hasOwn(map, id) ? map[id] : null;
}
export function exportEntityBreakdown(data: DailyActivityResponse, aliases: Record<string, string> = {}): EntityBreakdown[] {
	const grouped = new Map<string, EntityBreakdown>();
	for (const day of data.results)
		for (const [name, item] of Object.entries(resolveEntities(day.breakdown))) {
			const id = teamId(item.api_key_breakdown) || name,
				keyAlias = Object.values(item.api_key_breakdown).find((k) => k.metadata.key_alias)?.metadata.key_alias;
			const current = grouped.get(name) ?? {
				metrics: emptyMetrics(),
				metadata: { alias: keyAlias || alias(aliases, id) || name, id },
			};
			addMetrics(current.metrics, item.metrics);
			grouped.set(name, current);
		}
	return [...grouped.values()].sort((a, b) => b.metrics.spend - a.metrics.spend);
}
function values(m: SpendMetrics) {
	return {
		"Spend ($)": formatNumberWithCommas(m.spend, 4),
		Requests: m.api_requests,
		"Successful Requests": m.successful_requests,
		"Failed Requests": m.failed_requests,
		"Total Tokens": m.total_tokens,
		"Prompt Tokens": m.prompt_tokens || 0,
		"Completion Tokens": m.completion_tokens || 0,
	};
}
function baseRow(date: string, label: string, id: string | null, aliases: Record<string, string>): ExportRow {
	return { Date: date, [label]: alias(aliases, id) || "-", [label + " ID"]: id || "-" };
}
export function generateExportData(
	data: DailyActivityResponse,
	scope: ExportScope,
	label: string,
	aliases: Record<string, string> = {},
): ExportRow[] {
	const rows: ExportRow[] = [];
	if (scope === "daily_with_keys") {
		const grouped = new Map<string, { date: string; team: string; key: string; alias: string | null; metrics: SpendMetrics }>();
		for (const day of data.results)
			for (const [entity, item] of Object.entries(resolveEntities(day.breakdown)))
				for (const [id, key] of Object.entries(item.api_key_breakdown)) {
					const team = key.metadata.team_id || entity,
						unique = JSON.stringify([day.date, team, id]);
					const current = grouped.get(unique) ?? {
						date: day.date,
						team,
						key: id,
						alias: key.metadata.key_alias,
						metrics: emptyMetrics(),
					};
					addMetrics(current.metrics, key.metrics);
					grouped.set(unique, current);
				}
		for (const item of grouped.values())
			rows.push({
				...baseRow(item.date, label, item.team, aliases),
				"Key Alias": item.alias || "-",
				"Key ID": item.key,
				...values(item.metrics),
			});
	} else
		for (const day of data.results)
			for (const item of Object.values(resolveEntities(day.breakdown))) {
				const id = teamId(item.api_key_breakdown);
				if (scope === "daily_with_models") {
					for (const [name, model] of Object.entries(day.breakdown.models)) {
						const metrics = emptyMetrics();
						let found = false;
						// Attribute each entity's keys using the model's own breakdown, rather than
						// repeating every key's total under every model.
						for (const key of Object.keys(item.api_key_breakdown)) {
							if (Object.hasOwn(model.api_key_breakdown, key)) {
								addMetrics(metrics, model.api_key_breakdown[key].metrics);
								found = true;
							}
						}
						if (found)
							rows.push({
								...baseRow(day.date, label, id, aliases),
								Model: name,
								"Spend ($)": formatNumberWithCommas(metrics.spend, 4),
								Requests: metrics.api_requests,
								Successful: metrics.successful_requests,
								Failed: metrics.failed_requests,
								"Total Tokens": metrics.total_tokens,
							});
					}
				} else rows.push({ ...baseRow(day.date, label, id, aliases), ...values(item.metrics) });
			}
	return rows.sort((a, b) => new Date(String(a.Date)).getTime() - new Date(String(b.Date)).getTime());
}
export function generateMetadata(
	entity: EntityType,
	range: DateRangeValue,
	filters: string[],
	scope: ExportScope,
	data: DailyActivityResponse,
) {
	return {
		export_date: new Date().toISOString(),
		entity_type: entity,
		date_range: { from: range.from?.toISOString(), to: range.to?.toISOString() },
		filters_applied: filters.length ? filters : "None",
		export_scope: scope,
		summary: {
			total_spend: data.metadata.total_spend,
			total_requests: data.metadata.total_api_requests,
			successful_requests: data.metadata.total_successful_requests,
			failed_requests: data.metadata.total_failed_requests,
			total_tokens: data.metadata.total_tokens,
		},
	};
}
export function exportCsv(rows: ExportRow[]): string {
	if (!rows.length) return "";
	const keys = Object.keys(rows[0]);
	function cell(value: string | number | undefined) {
		const text = value === undefined ? "" : String(value);
		return /[",\r\n\uFEFF]/.test(text) || /^\s|\s$/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
	}
	return [keys.map(cell).join(","), ...rows.map((row) => keys.map((k) => cell(row[k])).join(","))].join("\r\n");
}
export function downloadUsage(content: string, type: string, entity: EntityType, scope: ExportScope, extension: string) {
	const blob = new Blob([content], { type }),
		url = URL.createObjectURL(blob),
		a = document.createElement("a");
	a.href = url;
	a.download = entity + "_usage_" + scope + "_" + new Date().toISOString().split("T")[0] + "." + extension;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
