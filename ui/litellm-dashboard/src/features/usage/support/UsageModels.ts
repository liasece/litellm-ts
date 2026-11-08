export interface SpendMetrics {
	spend: number;
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	api_requests: number;
	successful_requests: number;
	failed_requests: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
}
export interface KeyMetadata {
	key_alias: string | null;
	key_name?: string | null;
	team_id: string | null;
	tags?: { tag: string; usage: number }[];
}
export interface KeyMetricWithMetadata {
	metrics: SpendMetrics;
	metadata: KeyMetadata;
}
export interface MetricWithMetadata {
	metrics: SpendMetrics;
	metadata: Record<string, unknown>;
	api_key_breakdown: Record<string, KeyMetricWithMetadata>;
}
export interface BreakdownMetrics {
	models: Record<string, MetricWithMetadata>;
	model_groups: Record<string, MetricWithMetadata>;
	mcp_servers: Record<string, MetricWithMetadata>;
	providers: Record<string, MetricWithMetadata>;
	api_keys: Record<string, KeyMetricWithMetadata>;
	entities: Record<string, MetricWithMetadata>;
	endpoints: Record<string, MetricWithMetadata>;
}
export interface DailyData {
	date: string;
	metrics: SpendMetrics;
	breakdown: BreakdownMetrics;
}
export interface UsageMetadata {
	total_spend: number;
	total_prompt_tokens: number;
	total_completion_tokens: number;
	total_tokens: number;
	total_api_requests: number;
	total_successful_requests: number;
	total_failed_requests: number;
	total_cache_read_input_tokens: number;
	total_cache_creation_input_tokens: number;
	total_pages: number;
	has_more: boolean;
	page: number;
	[key: string]: unknown;
}
export interface DailyActivityResponse {
	results: DailyData[];
	metadata: UsageMetadata;
}
export interface TopApiKeyData {
	api_key: string;
	key_alias: string | null;
	key_name?: string | null;
	team_id: string | null;
	spend: number;
	requests: number;
	tokens: number;
}
export interface TopModelData {
	model: string;
	spend: number;
	requests: number;
	successful_requests: number;
	failed_requests: number;
	tokens: number;
}
export interface ModelActivityData {
	label: string;
	total_requests: number;
	total_successful_requests: number;
	total_failed_requests: number;
	total_cache_read_input_tokens: number;
	total_cache_creation_input_tokens: number;
	total_tokens: number;
	prompt_tokens: number;
	completion_tokens: number;
	total_spend: number;
	top_api_keys: TopApiKeyData[];
	top_models: TopModelData[];
	daily_data: { date: string; metrics: SpendMetrics }[];
}
export type EntityType = "organization" | "team" | "customer" | "tag" | "agent" | "user";
export type UsageView = "global" | EntityType | "user-agent-activity";
export interface EntityOption {
	label: string;
	value: string;
}
export interface UsageTeam {
	team_id: string;
	team_alias?: string | null;
}
export interface UsageQuery {
	from: Date;
	to: Date;
	entity: "global" | EntityType;
	selected: string[];
}
export interface UsageApi {
	page(query: UsageQuery, page: number, signal?: AbortSignal): Promise<DailyActivityResponse>;
	aggregated(query: UsageQuery, signal?: AbortSignal): Promise<DailyActivityResponse>;
}
export interface ModelRanking {
	key: string;
	spend: number;
	requests: number;
	successful_requests: number;
	failed_requests: number;
	tokens: number;
	prompt_tokens: number;
	cache_read_input_tokens: number;
}
export interface ProviderRanking {
	provider: string;
	spend: number;
	requests: number;
	successful_requests: number;
	failed_requests: number;
	tokens: number;
}
export interface KeyRanking {
	api_key: string;
	key_alias: string;
	tags: { tag: string; usage: number }[];
	spend: number;
}
