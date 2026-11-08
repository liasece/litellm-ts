export interface CacheChartRow {
	name: string;
	"LLM API requests": number;
	"Cache hit": number;
	"Cached Completion Tokens": number;
	"Generated Completion Tokens": number;
}
export function cacheMetrics(rows: Record<string, unknown>[], keys: string[], models: string[]) {
	const filtered = rows.filter(
		(row) => (!keys.length || keys.includes(String(row.api_key ?? ""))) && (!models.length || models.includes(String(row.model ?? ""))),
	);
	let hits = 0,
		tokens = 0,
		requests = 0;
	const chart: CacheChartRow[] = [];
	for (const row of filtered) {
		const total = Number(row.total_rows) || 0,
			hit = Number(row.cache_hit_true_rows) || 0,
			cached = Number(row.cached_completion_tokens) || 0,
			generated = Number(row.generated_completion_tokens) || 0;
		hits += hit;
		tokens += cached;
		requests += total - hit;
		const name = String(row.call_type || "Unknown");
		let item = chart.find((item) => item.name === name);
		if (!item) {
			item = { name, "LLM API requests": 0, "Cache hit": 0, "Cached Completion Tokens": 0, "Generated Completion Tokens": 0 };
			chart.push(item);
		}
		item["LLM API requests"] += total - hit;
		item["Cache hit"] += hit;
		item["Cached Completion Tokens"] += cached;
		item["Generated Completion Tokens"] += generated;
	}
	return { chart, hits, tokens, ratio: hits + requests > 0 ? ((hits / (hits + requests)) * 100).toFixed(2) : "0" };
}
export function compactCacheNumber(value: number): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, notation: "compact", compactDisplay: "short" }).format(value);
}
