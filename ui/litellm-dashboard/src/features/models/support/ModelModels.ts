import type { UiSelectOption } from "../../platform/ui/UiTypes";
export interface ProxyModelInfo extends Record<string, unknown> {
	id?: string | null;
	db_model?: boolean;
	created_by?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	team_id?: string | null;
	access_groups?: string[];
	fallbacks?: string[];
	override_model_name?: string | null;
	override_reasoning_effort?: string | null;
	force_reasoning_effort?: string | null;
	input_cost_per_token?: number | string | null;
	output_cost_per_token?: number | string | null;
	cache_read_input_token_cost?: number | string | null;
	max_tokens?: number | null;
	max_input_tokens?: number | null;
}
export interface ProxyModel extends Record<string, unknown> {
	model_name: string;
	litellm_params: Record<string, unknown>;
	model_info: ProxyModelInfo;
}
export interface DisplayProxyModel extends ProxyModel {
	provider: string;
	litellm_model_name: string | null;
	input_cost: number | null;
	output_cost: number | null;
	cache_read_input_cost: number | null;
	api_base: unknown;
	cleanedLitellmParams: Record<string, unknown>;
	max_tokens: unknown;
	max_input_tokens: unknown;
}
export interface ModelPage {
	data: ProxyModel[];
	total_count: number;
	current_page: number;
	total_pages: number;
	size: number;
}
export interface ModelListQuery {
	page: number;
	size: number;
	search?: string;
	modelId?: string;
	teamId?: string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}
export interface ModelCredential extends Record<string, unknown> {
	credential_name: string;
	credential_values: Record<string, unknown>;
	credential_info: Record<string, unknown>;
}
export interface ModelMapping {
	public_name: string;
	litellm_model: string;
}
export interface ModelDeploymentRequest {
	model_name: string;
	litellm_params: Record<string, unknown>;
	model_info: Record<string, unknown>;
}
export interface ModelHealthStatus {
	status: "healthy" | "unhealthy" | "checking" | "none" | "unknown";
	lastCheck: string;
	lastSuccess?: string;
	loading: boolean;
	error?: string;
	fullError?: string;
	successResponse?: unknown;
}
export interface ModelHealthResponse {
	healthy_count: number;
	unhealthy_count: number;
	healthy_endpoints?: Record<string, unknown>[];
	unhealthy_endpoints?: Record<string, unknown>[];
}
export interface ProviderCredentialField {
	key: string;
	label: string;
	placeholder?: string | null;
	tooltip?: string | null;
	required?: boolean;
	field_type?: string;
	options?: string[] | null;
	default_value?: string | null;
}
export interface ProviderMetadata {
	provider: string;
	provider_display_name: string;
	litellm_provider?: string;
	credential_fields: ProviderCredentialField[];
}
export interface ModelCatalog {
	costs: Record<string, Record<string, unknown>>;
	credentials: ModelCredential[];
	models: string[];
	accessGroups: string[];
	uiSettings: Record<string, unknown>;
	hub: Record<string, unknown>[];
	router: Record<string, unknown>;
	providerFields: ProviderMetadata[];
	providerError?: string;
	teams: import("../../virtual-keys/support/VirtualKeyModels").KeyTeam[];
}
export const modelRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const modelString = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");
export const modelStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export const modelInput = (value: unknown): string | number | null =>
	typeof value === "string" || typeof value === "number" ? value : null;
export function modelOptions(values: readonly string[]): UiSelectOption[] {
	return values.map((value) => ({ value, label: value }));
}
export function emptyModelCatalog(): ModelCatalog {
	return {
		costs: {},
		credentials: [],
		models: [],
		accessGroups: [],
		uiSettings: {},
		hub: [],
		router: {},
		providerFields: [],
		teams: [],
	};
}
