export interface SearchToolParams extends Record<string, unknown> {
	search_provider: string;
	api_key?: string;
	api_base?: string;
	timeout?: number;
	max_retries?: number;
}
export interface SearchTool extends Record<string, unknown> {
	search_tool_id?: string;
	search_tool_name: string;
	litellm_params: SearchToolParams;
	search_tool_info?: { description?: string };
	created_at?: string;
	updated_at?: string;
	is_from_config?: boolean;
}
export interface SearchProvider {
	provider_name: string;
	ui_friendly_name: string;
}
export interface SearchDraft extends Record<string, unknown> {
	search_tool_name?: string;
	search_provider?: string;
	api_key?: string;
	api_base?: string;
	timeout?: string | number;
	max_retries?: string | number;
	description?: string;
}
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}
export interface SearchConnectionResult {
	status: "success" | "error";
	message: string;
	test_query?: string;
	results_count?: number;
	error_type?: string;
}
