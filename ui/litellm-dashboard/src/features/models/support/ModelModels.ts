import type { UpstreamModelInfoPayload } from "./UpstreamModelInfoModels";
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
/**
 * 部署失败触发 fallback 后的活跃冷却。
 * `remaining_ms` 是服务端构造响应时的剩余时间，前端收到后换算成本地截止时刻按秒递减；
 * `expires_at` 保留绝对时间用于排查，不直接参与本地时钟计算，避免浏览器与服务器时钟偏差。
 */
export interface ModelCooldown {
	deployment_id: string;
	duration_ms: number;
	remaining_ms: number;
	expires_at: string;
}
export interface ProxyModel extends Record<string, unknown> {
	model_name: string;
	litellm_params: Record<string, unknown>;
	model_info: ProxyModelInfo;
	/** `/v2/model/info` 带出的上游信息；没有订阅上游或尚未抓取时缺省。 */
	upstream_model_info?: UpstreamModelInfoPayload;
	/** 该 deployment 当前活跃的 fallback 冷却；无冷却时缺省。 */
	cooldown?: ModelCooldown;
}
/** 模型峰谷定价窗口；days 为 ISO 星期（1=周一 … 7=周日），start/end 为时区内 HH:mm，左闭右开。 */
export interface ModelPeakWindow {
	days: number[];
	start: string;
	end: string;
}
/** 模型峰谷定价：基础价按空闲时段配置，峰时乘 `multiplier`。 */
export interface ModelPeakPricing {
	windows: ModelPeakWindow[];
	/** IANA 时区；缺省 Asia/Shanghai。 */
	timezone?: string;
	multiplier: number;
}
export interface DisplayProxyModel extends ProxyModel {
	provider: string;
	litellm_model_name: string | null;
	input_cost: number | null;
	output_cost: number | null;
	cache_read_input_cost: number | null;
	/** 校验过的峰谷配置；没有或不合法时为 null（列表据此决定单档还是两档）。 */
	peak_pricing?: ModelPeakPricing | null;
	api_base: unknown;
	cleanedLitellmParams: Record<string, unknown>;
	max_tokens: unknown;
	max_input_tokens: unknown;
	context_window?: unknown;
	max_output_tokens?: unknown;
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
