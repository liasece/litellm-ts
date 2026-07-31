/**
 * Models 页面支撑端点
 *
 * Python LiteLLM Dashboard 的 Models 页面需要一批带鉴权的端点来获取
 * 模型详情、模型组信息、成本映射和 pass-through 配置。
 * 这些端点缺失时 WebUI 会出现 client-side exception。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 *
 * 关键端点说明：
 * - /v2/model/info：WebUI Models 主表数据源。Python 行为是按 Router deployments
 *   构造带分页的响应（{ data, total_count, current_page, total_pages, size }）。
 *   此实现早期是空 stub，会让 WebUI 在主表空数据时走入异常分支甚至卡死。
 * - /model_group/info：AI Hub / Models 页面左侧模型组下拉的数据源。
 *   必须返回 { data: [...] } 数组，否则前端 modelHubData?.data?.find 会抛
 *   "n.find is not a function"。
 */

import type { Router as ExpressRouter } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { parsePositiveInt, firstQueryString } from "../core/api/queryParams";
import type { ServiceConfig } from "../core/config";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Deployment, LitellmParams } from "../types/router";
import type { ModelInfo } from "../types/config";
import type { Router } from "../router/Router";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import { modelCostMapService, type ModelCostMapService } from "../cost/ModelCostMapService";
import { buildEnrichedModelInfo, buildModelGroupInfoResponse } from "./modelGroupBuilder";

/** /v2/model/info 分页默认值与边界常量 */
const DEFAULT_MODEL_INFO_PAGE = 1;
const DEFAULT_MODEL_INFO_PAGE_SIZE = 50;
const EMPTY_TOTAL_PAGES = 0;
const MIN_TOTAL_PAGES = 1;

const HTTP_FORBIDDEN = 403;

const SENSITIVE_CONFIG_KEY_PATTERN = /(master_key|password|secret|api_key|token)/i;

const CONFIG_FIELD_INFO_ALLOWED_FIELDS: ReadonlySet<string> = new Set<string>([
	"environment",
	"verboseErrors",
	"tempDir",
	"store_model_in_db",
	"model_group_alias",
	"websearch_override_target_model",
	"skip_provider_token_counting",
	"disable_adding_master_key_hash_to_db",
	"enable_public_model_hub",
	"strategy",
	"healthCheckIntervalSec",
	"maxConsecutiveFailures",
	"allowed_fails",
	"cooldown_time",
	"num_retries",
	"max_fallbacks",
	"routing_strategy",
	"fallbacks",
	"enable_pre_call_checks",
	"request_timeout",
	"success_callback",
	"failure_callback",
	"callbacks",
	"service_callbacks",
	"cache",
	"set_verbose",
]);

/** /router/settings 静态字段元数据（复刻 PY ROUTER_SETTINGS_FIELDS，litellm/types/management_endpoints/router_settings_endpoints.py） */
const ROUTER_SETTINGS_FIELD_DEFS: ReadonlyArray<{
	readonly field_name: string;
	readonly field_type: string;
	readonly field_description: string;
	readonly field_default: unknown;
	readonly ui_field_name: string;
	readonly link?: string;
}> = [
	{
		field_name: "routing_strategy",
		field_type: "String",
		field_description: "Routing strategy to use for load balancing across deployments",
		field_default: "simple-shuffle",
		ui_field_name: "Routing Strategy",
	},
	{
		field_name: "routing_strategy_args",
		field_type: "Dictionary",
		field_description: "Arguments to pass to the routing strategy (e.g., ttl, lowest_latency_buffer for latency-based-routing)",
		field_default: {},
		ui_field_name: "Routing Strategy Args",
	},
	{
		field_name: "num_retries",
		field_type: "Integer",
		field_description: "Number of retries for failed requests",
		field_default: 0,
		ui_field_name: "Number of Retries",
	},
	{
		field_name: "timeout",
		field_type: "Float",
		field_description: "Timeout for requests in seconds",
		field_default: null,
		ui_field_name: "Timeout",
	},
	{
		field_name: "stream_timeout",
		field_type: "Float",
		field_description: "Timeout for streaming requests in seconds",
		field_default: null,
		ui_field_name: "Stream Timeout",
	},
	{
		field_name: "max_fallbacks",
		field_type: "Integer",
		field_description: "Maximum number of fallbacks to try before exiting the call",
		field_default: 5,
		ui_field_name: "Max Fallbacks",
	},
	{
		field_name: "fallbacks",
		field_type: "List",
		field_description: "List of fallback model mappings",
		field_default: [],
		ui_field_name: "Fallbacks",
	},
	{
		field_name: "context_window_fallbacks",
		field_type: "List",
		field_description: "List of fallback models for context window errors",
		field_default: [],
		ui_field_name: "Context Window Fallbacks",
	},
	{
		field_name: "content_policy_fallbacks",
		field_type: "List",
		field_description: "List of fallback models for content policy errors",
		field_default: [],
		ui_field_name: "Content Policy Fallbacks",
	},
	{
		field_name: "allowed_fails",
		field_type: "Integer",
		field_description: "Number of times a deployment can fail before being added to cooldown",
		field_default: null,
		ui_field_name: "Allowed Fails",
	},
	{
		field_name: "cooldown_time",
		field_type: "Float",
		field_description: "Time in seconds to cooldown a deployment after failure",
		field_default: null,
		ui_field_name: "Cooldown Time",
	},
	{
		field_name: "retry_after",
		field_type: "Integer",
		field_description: "Minimum time to wait before retrying a failed request in seconds",
		field_default: 0,
		ui_field_name: "Retry After",
	},
	{
		field_name: "retry_policy",
		field_type: "Dictionary",
		field_description: "Custom retry policy for different exception types",
		field_default: null,
		ui_field_name: "Retry Policy",
	},
	{
		field_name: "model_group_alias",
		field_type: "Dictionary",
		field_description: "Aliases for model groups",
		field_default: {},
		ui_field_name: "Model Group Alias",
	},
	{
		field_name: "enable_pre_call_checks",
		field_type: "Boolean",
		field_description: "Enable pre-call checks before routing requests",
		field_default: false,
		ui_field_name: "Enable Pre-call Checks",
	},
	{
		field_name: "default_litellm_params",
		field_type: "Dictionary",
		field_description: "Default parameters for Router.chat.completion.create",
		field_default: null,
		ui_field_name: "Default LiteLLM Params",
	},
	{
		field_name: "set_verbose",
		field_type: "Boolean",
		field_description: "Enable verbose logging for router",
		field_default: false,
		ui_field_name: "Verbose Logging",
	},
	{
		field_name: "default_max_parallel_requests",
		field_type: "Integer",
		field_description: "Default maximum parallel requests across all deployments",
		field_default: null,
		ui_field_name: "Max Parallel Requests",
	},
	{
		field_name: "enable_tag_filtering",
		field_type: "Boolean",
		field_description: "Enable tag-based routing to route requests based on tags",
		field_default: false,
		ui_field_name: "Enable Tag Filtering",
		link: "https://docs.litellm.ai/docs/proxy/tag_routing",
	},
	{
		field_name: "tag_filtering_match_any",
		field_type: "Boolean",
		field_description: "Match any tag instead of all tags for tag-based routing",
		field_default: true,
		ui_field_name: "Tag Filtering Match Any",
	},
	{
		field_name: "disable_cooldowns",
		field_type: "Boolean",
		field_description: "Disable cooldown mechanism for failed deployments",
		field_default: null,
		ui_field_name: "Disable Cooldowns",
	},
];

/** 路由策略选项（对齐 PY Router.__init__ routing_strategy Literal 参数） */
const ROUTING_STRATEGY_OPTIONS: readonly string[] = [
	"simple-shuffle",
	"least-busy",
	"usage-based-routing",
	"latency-based-routing",
	"cost-based-routing",
	"usage-based-routing-v2",
];

/** 路由策略描述（复刻 PY ROUTING_STRATEGY_DESCRIPTIONS） */
const ROUTING_STRATEGY_DESCRIPTIONS: Readonly<Record<string, string>> = {
	"simple-shuffle": "Randomly picks a deployment from the list. Simple and fast.",
	"least-busy": "Routes to the deployment with the lowest number of ongoing requests.",
	"latency-based-routing": "Routes to the deployment with the lowest latency over a sliding window.",
	"cost-based-routing": "Routes to the deployment with the lowest cost per token.",
	"usage-based-routing": "Routes to the deployment with the lowest TPM (Tokens Per Minute) usage. (deprecated)",
	"usage-based-routing-v2": "Improved version of usage-based routing with better tracking.",
};

/**
 * 构造 /router/settings 的 current_values（对齐 PY：llm_router 属性值 < config router_settings 覆盖）。
 * TS 端以 config.routerSettings（camelCase 解析值）为底，routerSettingsRaw（snake_case 原文）覆盖；
 * 批次 C4：DB router_settings（LiteLLM_Config 表）再覆盖一层（对齐 Python get_config 的 DB 优先语义）。
 * @param config - 服务配置
 */
async function buildRouterSettingsCurrentValues(config: ServiceConfig | undefined): Promise<Record<string, unknown>> {
	const values: Record<string, unknown> = {
		routing_strategy: "simple-shuffle",
		num_retries: 0,
		max_fallbacks: 5,
		enable_pre_call_checks: false,
		set_verbose: false,
		// PY Router 缺省 timeout=6000 秒（router.py __init__ 缺省值）
		timeout: 6000,
	};
	if (!config) {
		return values;
	}
	for (const [key, value] of Object.entries(config.routerSettings)) {
		if (value !== undefined) {
			values[key] = value;
		}
	}
	const raw = config.routerSettingsRaw;
	if (raw) {
		for (const [key, value] of Object.entries(raw)) {
			values[key] = value;
		}
	}
	// DB 优先：DB 中出现的键覆盖 yaml 有效值
	const dbRouterSettings = await dbConfigProvider.getParam("router_settings");
	for (const [key, value] of Object.entries(dbRouterSettings)) {
		if (value !== null && value !== undefined) {
			values[key] = value;
		}
	}
	return values;
}

const AVAILABLE_CALLBACKS: Readonly<
	Record<
		string,
		{
			readonly litellm_callback_name: string;
			readonly litellm_callback_params: readonly string[];
			readonly ui_callback_name: string;
		}
	>
> = {
	langfuse: {
		litellm_callback_name: "langfuse",
		litellm_callback_params: ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_HOST"],
		ui_callback_name: "Langfuse",
	},
	otel: {
		litellm_callback_name: "otel",
		litellm_callback_params: ["OTEL_EXPORTER", "OTEL_ENDPOINT", "OTEL_HEADERS"],
		ui_callback_name: "OpenTelemetry",
	},
	s3: {
		litellm_callback_name: "s3",
		litellm_callback_params: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION_NAME"],
		ui_callback_name: "s3 Bucket (AWS)",
	},
	openmeter: {
		litellm_callback_name: "openmeter",
		litellm_callback_params: ["OPENMETER_API_ENDPOINT", "OPENMETER_API_KEY"],
		ui_callback_name: "OpenMeter",
	},
	custom_callback_api: {
		litellm_callback_name: "custom_callback_api",
		litellm_callback_params: ["GENERIC_LOGGER_ENDPOINT", "GENERIC_LOGGER_HEADERS"],
		ui_callback_name: "Custom Callback API",
	},
	generic_api: {
		litellm_callback_name: "generic_api",
		litellm_callback_params: ["GENERIC_LOGGER_ENDPOINT", "GENERIC_LOGGER_HEADERS"],
		ui_callback_name: "Custom Callback API",
	},
	datadog: {
		litellm_callback_name: "datadog",
		litellm_callback_params: ["DD_API_KEY", "DD_SITE"],
		ui_callback_name: "Datadog",
	},
	braintrust: {
		litellm_callback_name: "braintrust",
		litellm_callback_params: ["BRAINTRUST_API_KEY", "BRAINTRUST_API_BASE"],
		ui_callback_name: "Braintrust",
	},
	langsmith: {
		litellm_callback_name: "langsmith",
		litellm_callback_params: ["LANGSMITH_API_KEY", "LANGSMITH_PROJECT", "LANGSMITH_DEFAULT_RUN_NAME"],
		ui_callback_name: "Langsmith",
	},
	lago: {
		litellm_callback_name: "lago",
		litellm_callback_params: ["LAGO_API_BASE", "LAGO_API_KEY", "LAGO_API_EVENT_CODE", "LAGO_API_CHARGE_BY"],
		ui_callback_name: "Lago Billing",
	},
	traceloop: {
		litellm_callback_name: "traceloop",
		litellm_callback_params: ["TRACELOOP_API_KEY"],
		ui_callback_name: "Traceloop",
	},
};

/** 单个已配置回调（PY get_config 的 _data_to_return 项：{name, variables, type}） */
interface ConfiguredCallbackItem {
	readonly name: string;
	readonly variables: Record<string, unknown>;
	readonly type: "success" | "failure" | "success_and_failure";
}

interface ConfigCallbacksResponse {
	readonly status: "success";
	readonly callbacks: readonly ConfiguredCallbackItem[];
	readonly alerts: readonly unknown[];
	readonly router_settings: Record<string, unknown>;
	readonly available_callbacks: typeof AVAILABLE_CALLBACKS;
}

function assertProxyAdmin(req: { readonly auth?: UserAPIKeyAuth }): void {
	const auth = req.auth;
	if (!auth) {
		throw ApiError.unauthorized("Missing admin auth");
	}
	// PY: 仅校验 user_role（proxy_server.py get_model_cost_map_source:
	// `user_role != LitellmUserRoles.PROXY_ADMIN → 403`），不校验 team_id——
	// WebUI 登录态 virtual key 属于 litellm-dashboard team 但角色为 proxy_admin。
	if (auth.user_role !== PROXY_ADMIN_ROLE) {
		throw new ApiError(HTTP_FORBIDDEN, "Proxy admin role required");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeConfigValue(fieldName: string, value: unknown): unknown {
	if (SENSITIVE_CONFIG_KEY_PATTERN.test(fieldName)) {
		return null;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeConfigValue(fieldName, item));
	}
	if (!isRecord(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		out[key] = sanitizeConfigValue(key, nestedValue);
	}
	return out;
}

function publicConfigRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		return {};
	}
	return sanitizeConfigValue("", value) as Record<string, unknown>;
}

function pickStringArray(record: Record<string, unknown>, fieldName: string): string[] {
	const value = record[fieldName];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * PY get_config 的 process_callback：环境变量值缺省 null（不脱敏值，PY 解密后返回，TS 对齐缺省 null）
 * @param litellmSettings - litellm_settings 配置块
 */
function buildConfiguredCallbacks(litellmSettings: Record<string, unknown>): ConfiguredCallbackItem[] {
	const items: ConfiguredCallbackItem[] = [];
	const pushAll = (names: readonly string[], type: ConfiguredCallbackItem["type"]): void => {
		for (const name of names) {
			const params = AVAILABLE_CALLBACKS[name as keyof typeof AVAILABLE_CALLBACKS]?.litellm_callback_params ?? [];
			const variables: Record<string, unknown> = {};
			for (const param of params) {
				variables[param] = process.env[param] ?? null;
			}
			items.push({ name: name, variables: variables, type: type });
		}
	};
	pushAll(pickStringArray(litellmSettings, "success_callback"), "success");
	pushAll(pickStringArray(litellmSettings, "failure_callback"), "failure");
	pushAll(pickStringArray(litellmSettings, "callbacks"), "success_and_failure");
	// PY: websearch_interception_params 配置存在时自动注册 websearch_interception callback
	// （callback_utils.py initialize_dynamic_callbacks）
	if (isRecord(litellmSettings["websearch_interception_params"])) {
		items.push({ name: "websearch_interception", variables: {}, type: "success_and_failure" });
	}
	return items;
}

/** PY get_config 的 alerting_data：email 变量集（缺省 null） */
function buildAlertingData(): readonly unknown[] {
	const emailVars: Record<string, unknown> = {};
	for (const varName of [
		"SMTP_HOST",
		"SMTP_PORT",
		"SMTP_USERNAME",
		"SMTP_PASSWORD",
		"SMTP_SENDER_EMAIL",
		"TEST_EMAIL_ADDRESS",
		"EMAIL_LOGO_URL",
		"EMAIL_SUPPORT_CONTACT",
	]) {
		emailVars[varName] = process.env[varName] ?? null;
	}
	return [{ name: "email", variables: emailVars }];
}

/**
 * PY llm_router.get_settings() 的键集与缺省值（router.py get_settings）。
 * 批次 C4：DB router_settings（LiteLLM_Config 表）覆盖 yaml 值
 * （对齐 Python get_config 的 DB 优先合并语义）。
 * @param config - 服务配置
 */
async function buildRouterSettingsForCallbacks(config: ServiceConfig | undefined): Promise<Record<string, unknown>> {
	const raw = config?.routerSettingsRaw ?? {};
	const rs = config?.routerSettings;
	const yamlValues: Record<string, unknown> = {
		routing_strategy_args: {},
		routing_strategy: raw["routing_strategy"] ?? rs?.routing_strategy ?? "simple-shuffle",
		allowed_fails: raw["allowed_fails"] ?? rs?.allowed_fails ?? null,
		cooldown_time: raw["cooldown_time"] ?? rs?.cooldown_time ?? null,
		num_retries: raw["num_retries"] ?? rs?.num_retries ?? null,
		// PY Router 缺省 timeout=6000 秒（router.py __init__ 缺省值）
		timeout: raw["timeout"] ?? raw["request_timeout"] ?? rs?.request_timeout ?? 6000,
		retry_after: raw["retry_after"] ?? 0,
		fallbacks: raw["fallbacks"] ?? rs?.fallbacks ?? [],
		context_window_fallbacks: raw["context_window_fallbacks"] ?? null,
		model_group_retry_policy: raw["model_group_retry_policy"] ?? {},
		retry_policy: raw["retry_policy"] ?? null,
		model_group_alias: raw["model_group_alias"] ?? rs?.model_group_alias ?? {},
	};
	// DB 优先：DB 中出现的键覆盖 yaml 有效值（对齐 _update_dictionary DB 语义）
	const dbRouterSettings = await dbConfigProvider.getParam("router_settings");
	for (const [key, value] of Object.entries(dbRouterSettings)) {
		if (value !== null && value !== undefined) {
			yamlValues[key] = value;
		}
	}
	return yamlValues;
}

async function buildConfigCallbacksResponse(config: ServiceConfig | undefined): Promise<ConfigCallbacksResponse> {
	// PY get_config 的 litellm_settings 源：DB（LiteLLM_Config 表，WebUI 设置项）优先，yaml 兜底
	const dbLitellmSettings = await dbConfigProvider.getParam("litellm_settings");
	const litellmSettings =
		Object.keys(dbLitellmSettings).length > 0
			? publicConfigRecord(dbLitellmSettings)
			: publicConfigRecord(
					config?.litellmSettingsRaw ?? (config as unknown as { litellm_settings?: unknown } | undefined)?.litellm_settings,
				);
	return {
		status: "success",
		callbacks: buildConfiguredCallbacks(litellmSettings),
		alerts: buildAlertingData(),
		router_settings: await buildRouterSettingsForCallbacks(config),
		available_callbacks: AVAILABLE_CALLBACKS,
	};
}

function resolveConfigFieldValue(config: ServiceConfig | undefined, fieldName: string): unknown {
	if (SENSITIVE_CONFIG_KEY_PATTERN.test(fieldName)) {
		return null;
	}
	if (!CONFIG_FIELD_INFO_ALLOWED_FIELDS.has(fieldName)) {
		throw new ApiError(HTTP_FORBIDDEN, `Config field "${fieldName}" is not readable`);
	}
	const sources: readonly Record<string, unknown>[] = [
		publicConfigRecord(config?.generalSettingsRaw),
		publicConfigRecord(config?.routerSettingsRaw),
		publicConfigRecord(config?.litellmSettingsRaw),
		publicConfigRecord(config?.generalSettings),
		publicConfigRecord(config?.routerSettings),
		publicConfigRecord(config?.litellmSettings),
	];
	for (const source of sources) {
		if (fieldName in source) {
			return source[fieldName];
		}
	}
	// PY 对未显式配置的布尔开关返回 False 而非 null（general_settings 缺省语义）
	if (CONFIG_FIELD_INFO_BOOLEAN_DEFAULT_FALSE.has(fieldName)) {
		return false;
	}
	return null;
}

/** /config/field/info 中缺省值为 false 的布尔字段（对齐 PY general_settings 缺省） */
const CONFIG_FIELD_INFO_BOOLEAN_DEFAULT_FALSE: ReadonlySet<string> = new Set<string>(["enable_public_model_hub"]);

/** 排序方向（对齐 Python LiteLLM 默认 asc） */
const enum ModelInfoSortOrder {
	Asc = "asc",
	Desc = "desc",
}

/** /v2/model/info 允许的 sortBy 字段白名单。未知值在解析阶段回退到 model_name。 */
enum ModelInfoSortField {
	MODEL_NAME = "model_name",
	ID = "id",
}

const DEFAULT_MODEL_INFO_SORT_BY = ModelInfoSortField.MODEL_NAME;

/**
 * Router 部署访问器抽象。
 * 允许测试用最简实现注入；主流程用 container.router.getDeployments()。
 */
export interface RouterDeploymentsAccessor {
	/** 返回 Router 当前持有的所有 deployments */
	getDeployments(): Deployment[];
	/** 可选：返回当前 fallback 配置（Router.getFallbacks）；缺省时 /v2/model/info 注入空 fallbacks */
	getFallbacks?(): Record<string, string[]>;
}

/** /v2/model/info 接受的 query 形状。明确列出字段，禁止 Record<string, unknown>。 */
interface V2ModelInfoQuery {
	readonly page?: string;
	readonly size?: string;
	readonly search?: string;
	readonly modelId?: string;
	/** 当前 TS 端未实现 team 过滤，仅为协议占位，避免前端发送被默默忽略。 */
	readonly teamId?: string;
	readonly sortBy?: string;
	readonly sortOrder?: string;
}

/**
 * 从 Express req.query（类型为 qs.ParsedQs）逐字段提取 string，
 * 返回类型安全的 V2ModelInfoQuery，消除 `req.query as unknown as V2ModelInfoQuery` 双重断言。
 * @param raw - Express req.query 原始值
 */
function parseModelInfoQuery(raw: Record<string, unknown>): V2ModelInfoQuery {
	return {
		page: firstQueryString(raw.page) ?? undefined,
		size: firstQueryString(raw.size) ?? undefined,
		search: firstQueryString(raw.search) ?? undefined,
		modelId: firstQueryString(raw.modelId ?? raw.model_id) ?? undefined,
		teamId: firstQueryString(raw.teamId ?? raw.team_id) ?? undefined,
		sortBy: firstQueryString(raw.sortBy ?? raw.sort_by) ?? undefined,
		sortOrder: firstQueryString(raw.sortOrder ?? raw.sort_order) ?? undefined,
	};
}

/** Python LiteLLM 分页响应（对齐 _paginate_models_response：data/total_count/current_page/total_pages/size） */
interface PaginatedModelInfoResponse {
	data: ModelInfoV2Item[];
	total_count: number;
	current_page: number;
	total_pages: number;
	size: number;
}

/** Python LiteLLM 兼容的 /v2/model/info 单元素 */
interface ModelInfoV2Item {
	model_name: string;
	litellm_params: Record<string, unknown>;
	model_info: Record<string, unknown>;
}

/** /v2/model/info 单模型查询响应 */
interface ModelInfoV1Response {
	data: ModelInfoV2Item[];
}

/** 管理编辑接口返回完整 litellm_params，确保现有值可以原样编辑。 */
function buildPublicLitellmParams(params: LitellmParams): Record<string, unknown> {
	return structuredClone(params);
}

/**
 * 读取 litellm_params 中的布尔开关（Python LiteLLM_Params 默认 false 的三个字段：
 * merge_reasoning_content_in_choices / use_in_pass_through / use_litellm_proxy）。
 * 未设置或非布尔时按 Python 默认值 false 返回。
 * @param params - 内部 litellm_params
 * @param fieldName - 字段名
 */
function pickBooleanParam(params: LitellmParams, fieldName: string): boolean {
	return params[fieldName] === true;
}

/**
 * 构造模型唯一 id：优先使用 model_info.id，否则用 litellm_params.model + 序号稳定生成。
 * index 仅在大于 0 时附加 `-${index}`，避免 base-0 出现 `foo-0` 这样的非 Python 风格 id。
 * @param modelInfo - 模型元信息
 * @param dep - 部署对象
 * @param index - 同一 model_name 下的序号（用于稳定 id）
 */
function resolveModelId(modelInfo: ModelInfo | undefined, dep: Deployment, index: number): string {
	if (modelInfo?.id) {
		return modelInfo.id;
	}
	const base = dep.litellm_params.model ?? dep.model_name;
	return index === 0 ? base : `${base}-${index}`;
}

/**
 * 把一个 Deployment 投影为 /v2/model/info 单元素。
 * model_info 对齐 Python `_enrich_model_info_with_litellm_data` 输出（73 键，缺省 null），
 * 另注入 `fallbacks`（该 model_group 当前 fallback 链，WebUI Fallback 列数据源，
 * 等价 PY get_all_fallbacks 按 model_group 反查 Router.fallbacks）。
 * litellm_params 为完整深拷贝 + Python 默认 false 的三个布尔开关。
 * @param dep - Router deployment
 * @param stableIndex - 同一 model_name 下的序号
 * @param modelInfo - 优先取自 dep.model_info；为空时使用兜底对象
 * @param fallbacks - 该 model_group 的当前 fallback 链（无配置时传空数组）
 * @param modelCostMap
 */
function buildModelInfoV2Item(
	dep: Deployment,
	stableIndex: number,
	modelInfo: ModelInfo | undefined,
	fallbacks: readonly string[],
	modelCostMap: ReturnType<ModelCostMapService["getSnapshot"]>["map"],
): ModelInfoV2Item {
	const fallbackId = resolveModelId(modelInfo, dep, stableIndex);
	return {
		model_name: dep.model_name,
		litellm_params: {
			...buildPublicLitellmParams(dep.litellm_params),
			merge_reasoning_content_in_choices: pickBooleanParam(dep.litellm_params, "merge_reasoning_content_in_choices"),
			use_in_pass_through: pickBooleanParam(dep.litellm_params, "use_in_pass_through"),
			use_litellm_proxy: pickBooleanParam(dep.litellm_params, "use_litellm_proxy"),
		},
		model_info: { ...buildEnrichedModelInfo(dep, fallbackId, modelCostMap), fallbacks: [...fallbacks] },
	};
}

/**
 * 解析排序方向，未识别值时回退到 asc。
 * @param raw - 原始 query 值
 */
function resolveSortOrder(raw: unknown): ModelInfoSortOrder {
	if (raw === ModelInfoSortOrder.Desc) {
		return ModelInfoSortOrder.Desc;
	}
	// 默认 asc：对齐 Python LiteLLM /v2/model/info 默认排序行为。
	return ModelInfoSortOrder.Asc;
}

/**
 * 解析 sortBy：仅接受 MODEL_INFO_SORT_FIELDS 白名单中的字段；
 * 未知值或非字符串值回退到 DEFAULT_MODEL_INFO_SORT_BY（model_name）。
 * @param raw - 原始 query 值
 */
function resolveSortBy(raw: unknown): ModelInfoSortField {
	if (raw === ModelInfoSortField.MODEL_NAME || raw === ModelInfoSortField.ID) {
		return raw;
	}
	return DEFAULT_MODEL_INFO_SORT_BY;
}

/**
 * 在原始 items 上做 stable 排序（仅支持预定义字段，避免任意属性读取）
 * @template T - 元素类型
 * @param items - 待排序元素
 * @param sortBy - 已校验的 ModelInfoSortField
 * @param order - asc / desc
 */
function sortItems<T extends { model_name: string; model_info: { id?: string } }>(
	items: T[],
	sortBy: ModelInfoSortField,
	order: ModelInfoSortOrder,
): T[] {
	const dir = order === ModelInfoSortOrder.Desc ? -1 : 1;
	// typed extractor map: 编译器保证每个 ModelInfoSortField 都有对应分支
	const keyOf: Record<ModelInfoSortField, (it: T) => string> = {
		[ModelInfoSortField.MODEL_NAME]: (it) => it.model_name ?? "",
		[ModelInfoSortField.ID]: (it) => it.model_info?.id ?? it.model_name ?? "",
	};
	const extractor = keyOf[sortBy];
	const indexed = items.map((item, originalIndex) => ({
		item: item,
		originalIndex: originalIndex,
		sortKey: extractor(item),
	}));
	indexed.sort((a, b) => {
		if (a.sortKey === b.sortKey) {
			// 稳定排序：原序靠前
			return a.originalIndex - b.originalIndex;
		}
		if (a.sortKey < b.sortKey) {
			return -1 * dir;
		}
		return 1 * dir;
	});
	return indexed.map((x) => x.item);
}

/**
 * 构造 /v2/model/info 分页响应
 * @param deployments - Router 全部 deployment
 * @param query - 原始 query
 * @param fallbacksByGroup - model_group → fallback 链（Router 当前配置）
 * @param modelCostMap
 */
function buildV2ModelInfoResponse(
	deployments: Deployment[],
	query: V2ModelInfoQuery,
	fallbacksByGroup: Record<string, string[]>,
	modelCostMap: ReturnType<ModelCostMapService["getSnapshot"]>["map"],
): PaginatedModelInfoResponse {
	const page = parsePositiveInt(query.page, DEFAULT_MODEL_INFO_PAGE);
	const size = parsePositiveInt(query.size, DEFAULT_MODEL_INFO_PAGE_SIZE);
	const search = (query.search ?? "").trim().toLowerCase();
	const modelId = (query.modelId ?? "").trim();
	// 注意：当前 TS 端尚未实现 team 访问控制，teamId 不参与过滤，
	// 也不读取 query.teamId（避免日后改回时与"已读未用"语义混淆）。
	const sortBy = resolveSortBy(query.sortBy);
	const sortOrder = resolveSortOrder(query.sortOrder);

	// 先按 model_name 分组并给每个分组内 deployment 一个 stable index，
	// 用于生成可重复的 id（与 Router 持有顺序一致 → 多次请求得到相同 id）。
	const grouped = new Map<string, Deployment[]>();
	for (const dep of deployments) {
		const deploymentGroup = grouped.get(dep.model_name);
		if (deploymentGroup) {
			deploymentGroup.push(dep);
		} else {
			grouped.set(dep.model_name, [dep]);
		}
	}

	let items: ModelInfoV2Item[] = [];
	for (const [groupName, group] of grouped) {
		const groupFallbacks = fallbacksByGroup[groupName] ?? [];
		group.forEach((dep, idx) => {
			items.push(buildModelInfoV2Item(dep, idx, dep.model_info, groupFallbacks, modelCostMap));
		});
	}

	// 过滤：search 命中 model_name / litellm_params.model / model_info.id
	if (search.length > 0) {
		items = items.filter((it) => {
			const modelNameLc = it.model_name.toLowerCase();
			const innerModel = typeof it.litellm_params["model"] === "string" ? (it.litellm_params["model"] as string).toLowerCase() : "";
			const idLc = typeof it.model_info["id"] === "string" ? (it.model_info["id"] as string).toLowerCase() : "";
			return modelNameLc.includes(search) || innerModel.includes(search) || idLc.includes(search);
		});
	}

	// 过滤：modelId 精确匹配 id
	if (modelId.length > 0) {
		items = items.filter((it) => it.model_info["id"] === modelId);
	}

	// 排序
	items = sortItems(items, sortBy, sortOrder);

	const total = items.length;
	// 对齐 Python LiteLLM 的空态：total_pages 保持 0；非空时至少 1
	const totalPages = total === 0 ? EMPTY_TOTAL_PAGES : Math.max(MIN_TOTAL_PAGES, Math.ceil(total / size));
	const start = (page - 1) * size;
	const pageData = items.slice(start, start + size);

	return {
		data: pageData,
		total_count: total,
		current_page: page,
		total_pages: totalPages,
		size: size,
	};
}

/**
 * 构造 /model_group/info 响应：从 deployments 按 model_name 聚合
 * @param deployments - Router 全部 deployment
 */
// buildModelGroupInfoResponse 与 model_info 推导（buildEnrichedModelInfo）
// 均在 ./modelGroupBuilder.ts，对齐 Python cost map 推导逻辑。

/**
 * 提取 deployments 列表：仅从 Router / RouterDeploymentsAccessor 注入获取。
 *
 * main.ts 必须传 container.router：Router deployments 是运行时真实模型源，
 * 包含 config 重构过程中可能丢失的 model_info 字段与默认 deployment 元信息
 * （如 custom_llm_provider、rpm/tpm、timeout 等）。如未注入则返回空数组，
 * 让 WebUI 走空态分支而不是显示陈旧数据。
 * @param routerOrAccessor
 */
function resolveDeployments(routerOrAccessor: Router | RouterDeploymentsAccessor | undefined): Deployment[] {
	if (routerOrAccessor && typeof (routerOrAccessor as RouterDeploymentsAccessor).getDeployments === "function") {
		try {
			return (routerOrAccessor as RouterDeploymentsAccessor).getDeployments();
		} catch {
			return [];
		}
	}
	return [];
}

/**
 * 提取当前 fallback 配置：仅当注入对象实现 getFallbacks（Router）时返回真实值，
 * 否则返回空表（每项 model_info.fallbacks 注入空数组，WebUI Fallback 列显示 "-"）。
 * @param routerOrAccessor
 */
function resolveFallbacks(routerOrAccessor: Router | RouterDeploymentsAccessor | undefined): Record<string, string[]> {
	if (routerOrAccessor && typeof routerOrAccessor.getFallbacks === "function") {
		try {
			return routerOrAccessor.getFallbacks();
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * 注册 Models 页面支撑端点
 * @param router - Express Router 实例（需经过鉴权中间件）
 * @param routerOrAccessor - TS Router 或 deployments 访问器；用于构造 /v2/model/info 真实数据
 * @param config - 服务配置；用于 model_cost_map 暴露真实 model_count 等
 * @param costMapService
 */
export function registerModelsPageSupportRoutes(
	router: ExpressRouter,
	routerOrAccessor?: Router | RouterDeploymentsAccessor,
	config?: ServiceConfig,
	costMapService: ModelCostMapService = modelCostMapService,
): void {
	// ── /v2/model/info ──────────────────────────────────────

	/**
	 * 分页获取模型详情列表
	 *
	 * WebUI 通过 useModelsInfo hook 调用，期望 PaginatedModelInfoResponse：
	 * { data: [...], total_count, current_page, total_pages, size }
	 * （与 Python `_paginate_models_response` 键集完全一致）。
	 *
	 * 支持 query：
	 *   - page, size: 分页
	 *   - search: 模糊匹配 model_name / litellm_params.model / model_info.id
	 *   - modelId: 精确匹配 model_info.id
	 *   - teamId: 当前 TS 端尚未实现 team 过滤；保留在 query 类型中以兼容前端，但端点不读取。
	 *   - sortBy, sortOrder: 排序（仅支持 model_name / id；sortOrder 非法值回退 asc）
	 */
	registerRoute(router, { method: "get", path: "/v2/model/info" }, (req) => {
		const deployments = resolveDeployments(routerOrAccessor);
		// 无部署时按 Python 空态返回 total_pages = 0
		return buildV2ModelInfoResponse(
			deployments,
			parseModelInfoQuery(req.query as Record<string, unknown>),
			resolveFallbacks(routerOrAccessor),
			costMapService.getSnapshot().map,
		);
	});

	// ── /v1/model/info ──────────────────────────────────────

	/** 单个模型详情查询（WebUI 编辑模型时使用） */
	registerRoute(router, { method: "get", path: "/v1/model/info" }, (req): ModelInfoV1Response => {
		const modelId = firstQueryString(req.query.litellm_model_id ?? req.query.model_id ?? req.query.modelId) ?? "";
		const deployments = resolveDeployments(routerOrAccessor);
		if (!modelId) {
			return { data: [] };
		}
		// 优先按 model_name 匹配；再按 litellm_params.model 匹配
		const dep =
			deployments.find((d) => d.model_info?.id === modelId) ??
			deployments.find((d) => d.model_name === modelId) ??
			deployments.find((d) => d.litellm_params.model === modelId);
		if (!dep) {
			throw new ApiError(HTTP_STATUS.NOT_FOUND, `Model "${modelId}" not found`);
		}
		// 同一 model_name 内按出现顺序分配 stableIndex
		const sameGroup = deployments.filter((d) => d.model_name === dep.model_name);
		const idx = sameGroup.indexOf(dep);
		const fallbacks = resolveFallbacks(routerOrAccessor)[dep.model_name] ?? [];
		return { data: [buildModelInfoV2Item(dep, idx, dep.model_info, fallbacks, costMapService.getSnapshot().map)] };
	});

	// ── /model_group/info ───────────────────────────────────

	/**
	 * 模型组信息
	 *
	 * WebUI modelHubCall 直接消费返回值。Python 真实返回：{ data: [...] }
	 * （注意：WebUI 端 modelHubData?.data?.filter / .find，必须有 data 数组，否则报
	 * "n.find is not a function"）
	 */
	registerRoute(router, { method: "get", path: "/model_group/info" }, () => {
		const deployments = resolveDeployments(routerOrAccessor);
		return buildModelGroupInfoResponse(deployments, costMapService.getSnapshot().map);
	});

	// ── /config/pass_through_endpoint ───────────────────────
	//
	// 当前为占位实现（STUB）。TS 端尚未实现 pass-through 端点的持久化与转发，
	// 暂以兼容 WebUI 消费契约的最小响应体返回，避免触发前端 `.find` 抛错。
	//
	// 响应 shape 与 Python LiteLLM 对齐：
	//   GET    /config/pass_through_endpoint
	//     → { endpoints: passThroughItem[] }
	//   GET    /config/pass_through_endpoint/team/:teamId
	//     → { endpoints: passThroughItem[] }（按团队过滤；stub 不过滤，返回空）
	//   POST   /config/pass_through_endpoint
	//     → { success: true, endpoint: passThroughItem | undefined }
	//   DELETE /config/pass_through_endpoint/:endpointPath
	//     → { success: true, endpoint_id: string | undefined }
	//
	// 注意：
	//   1. 这些 stub 不实际存储端点配置 — 重启后状态丢失。
	//   2. WebUI 拿到空 endpoints 时会渲染空表格，这是预期行为。
	//   3. 等 pass_through_endpoints 完整实现时，把内存 / DB 接入此处即可。
	//   4. 鉴权要求由主 router 统一保证（需 PROXY_ADMIN 或 team 角色），不需要
	//      在每个 stub 中重复校验。

	/** 获取所有 pass-through 端点配置（stub：始终返回空列表） */
	registerRoute(router, { method: "get", path: "/config/pass_through_endpoint" }, () => ({ endpoints: [] }));

	/** 获取指定团队的 pass-through 端点配置（stub：不实现按团队过滤） */
	registerRoute(router, { method: "get", path: "/config/pass_through_endpoint/team/:teamId" }, () => ({ endpoints: [] }));

	/** 创建 pass-through 端点（stub：不持久化） */
	registerRoute(router, { method: "post", path: "/config/pass_through_endpoint" }, (_req, _res) => ({
		success: true,
		endpoint: undefined,
	}));

	/** 删除 pass-through 端点（stub：不持久化） */
	registerRoute(router, { method: "delete", path: "/config/pass_through_endpoint/:endpointPath" }, (_req, _res) => ({
		success: true,
		endpoint_id: undefined,
	}));

	// ── /config/field/info ──────────────────────────────────

	/** 获取指定配置字段信息 */
	registerRoute(router, { method: "get", path: "/config/field/info" }, (req) => {
		assertProxyAdmin(req);
		const fieldName = firstQueryString(req.query.field_name ?? req.query.field ?? req.query.param);
		if (!fieldName) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Missing field_name");
		}
		return {
			field_name: fieldName,
			field_value: resolveConfigFieldValue(config, fieldName),
		};
	});

	// ── /router/settings ────────────────────────────────────

	/**
	 * 路由设置字段清单（Settings → Router Settings 页面数据源）。
	 * 对齐 Python litellm/proxy/management_endpoints/router_settings_endpoints.py：
	 * 静态字段元数据（ROUTER_SETTINGS_FIELDS）+ config 动态值 +
	 * routing_strategy_descriptions。field_value 合并序：router 运行值 < config 覆盖。
	 */
	registerRoute(router, { method: "get", path: "/router/settings" }, async (req) => {
		assertProxyAdmin(req);
		const currentValues = await buildRouterSettingsCurrentValues(config);
		const fields = ROUTER_SETTINGS_FIELD_DEFS.map((fieldDef) => ({
			field_name: fieldDef.field_name,
			field_type: fieldDef.field_type,
			field_value: fieldDef.field_name in currentValues ? currentValues[fieldDef.field_name] : null,
			field_description: fieldDef.field_description,
			field_default: fieldDef.field_default,
			options: fieldDef.field_name === "routing_strategy" ? [...ROUTING_STRATEGY_OPTIONS] : null,
			ui_field_name: fieldDef.ui_field_name,
			link: fieldDef.link ?? null,
		}));
		return {
			fields: fields,
			current_values: currentValues,
			routing_strategy_descriptions: ROUTING_STRATEGY_DESCRIPTIONS,
		};
	});
	// ── 配置回调（Models 页面 / 路由设置） ────────────────────

	/**
	 * 获取已配置的回调、告警与可用回调清单
	 *
	 * Python 真实响应见 `litellm/proxy/proxy_server.py:12681-12687`：
	 * `{ status, callbacks, alerts, router_settings, available_callbacks }`。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 * WebUI `getCallbacksCall` 直接 `response.json()`，必须返回 JSON 对象。
	 */
	registerRoute(router, { method: "get", path: "/get/config/callbacks" }, async (req) => {
		assertProxyAdmin(req);
		return await buildConfigCallbacksResponse(config);
	});

	// ── 成本映射相关 ─────────────────────────────────────────

	/**
	 * 获取模型成本映射数据源信息
	 *
	 * Python LiteLLM 真实响应见 `litellm/proxy/proxy_server.py:13048-13088`，
	 * 包含 `source`、`url`、`is_env_forced`、`fallback_reason`、`model_count`
	 * （基于 `litellm.model_cost` 长度）。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 * WebUI 渲染时会调用 `C.model_count.toLocaleString()`，所以 `model_count` 必须存在。
	 */
	registerRoute(router, { method: "get", path: "/model/cost_map/source" }, (req) => {
		assertProxyAdmin(req);
		const snapshot = costMapService.getSnapshot();
		return {
			source: snapshot.source,
			url: snapshot.url,
			is_env_forced: snapshot.isEnvForced,
			fallback_reason: snapshot.fallbackReason,
			model_count: snapshot.modelCount,
		};
	});

	/** 获取模型成本映射定时重载状态 */
	registerRoute(router, { method: "get", path: "/schedule/model_cost_map_reload/status" }, (req) => {
		assertProxyAdmin(req);
		const status = costMapService.getScheduleStatus();
		return { scheduled: status.scheduled, hours: status.hours, next_reload_at: status.nextReloadAt };
	});

	/** 调度模型成本映射重载 */
	registerRoute(router, { method: "post", path: "/schedule/model_cost_map_reload" }, (req) => {
		assertProxyAdmin(req);
		const hours = Number(firstQueryString(req.query.hours));
		if (!Number.isFinite(hours) || hours <= 0) {
			throw ApiError.badRequest("hours must be a finite number greater than 0");
		}
		const status = costMapService.schedule(hours);
		return { success: true, scheduled: status.scheduled, hours: status.hours, next_reload_at: status.nextReloadAt };
	});

	/** 取消模型成本映射重载调度 */
	registerRoute(router, { method: "delete", path: "/schedule/model_cost_map_reload" }, (req) => {
		assertProxyAdmin(req);
		const status = costMapService.cancelSchedule();
		return { success: true, scheduled: status.scheduled, hours: status.hours, next_reload_at: status.nextReloadAt };
	});

	/** 立即重载模型成本映射 */
	registerRoute(router, { method: "post", path: "/reload/model_cost_map" }, async (req) => {
		assertProxyAdmin(req);
		const snapshot = await costMapService.reload();
		return {
			status: "success",
			models_count: snapshot.modelCount,
			source: snapshot.source,
			timestamp: snapshot.loadedAt,
			fallback_reason: snapshot.fallbackReason,
		};
	});
}
