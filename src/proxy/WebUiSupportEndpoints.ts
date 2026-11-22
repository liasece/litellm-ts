import { SUBSCRIPTION_PROVIDERS } from "../subscriptions/SubscriptionProviders";
import { usageDateRange, isUsageAdmin } from "../spend/UsageQuery";
/**
 * WebUI 支撑端点
 *
 * Python LiteLLM Dashboard 会在首页并发读取一批配置、列表和静态信息。
 * 这些端点不是模型代理核心路径，但缺失会导致复制来的 WebUI 大量 401/404。
 *
 * 本文件拆分为两类：
 * - 公开端点：WebUI 启动时无 cookie 也要拉取（model cost map、provider fields 等），
 *   注册到 publicRouter。
 * - 鉴权端点：依赖 token / master_key 的配置/列表，注册到鉴权 router。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { UsageActivityCache } from "./UsageActivityCache";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import type { ServiceConfig } from "../core/config";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { createModuleLogger } from "../core/utils/logger";
import type { DrizzleDb } from "../core/db/Database";
import { subscriptionAccountDisplayName } from "../subscriptions/accountEmail";
import {
	localDateForTimestamp,
	nextCalendarDay,
	parseDailyActivityTimezone,
	type DailyActivityTimezone,
} from "../spend/DailyActivityTimezone";
import { configRepositoryFor } from "../repositories/ConfigRepository";
import { credentialRepositoryFor } from "../repositories/CredentialRepository";
import {
	webUiSupportRepositoryFor,
	type DailyActivityAuthScope,
	type DailyActivityEntityField,
	type DailyActivityFilters,
} from "../repositories/WebUiSupportRepository";
import type { Router as LiteLLMRouter } from "../router/Router";
import { buildModelGroupOverrides } from "../router/ModelOverrides";
import { validateModelGroupAliases } from "../shared/ModelGroupAlias";
import { auditModelReferences, isModelReferenceValidationPossible, loadModelReferenceState } from "../management/ModelReferences";
import { validateFallbackEntries } from "../shared/FallbackEntry";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE, PROXY_ADMIN_USER_ID } from "../types/webUiSession";
import providerCreateFieldsJson from "../data/provider_create_fields.json";
import { modelCostMapService, type ModelCostMapService } from "../cost/ModelCostMapService";
import {
	BUILTIN_CAPABILITIES_CONFIG_PARAM,
	type BuiltinCapabilityId,
	type BuiltinCapabilitySettings,
	normalizeBuiltinCapabilitiesConfig,
} from "../capabilities/BuiltinCapabilitiesConfig";

const HTTP_FORBIDDEN = 403;
const logger = createModuleLogger("WebUiSupportEndpoints");

/**
 * 仅 proxy_admin 可访问（对齐 Python user_role != PROXY_ADMIN → 403 语义）。
 * @param req - 请求（需已经过 authMiddleware）
 * @throws ApiError 401（无 auth）或 403（非 proxy_admin）
 */
function assertProxyAdmin(req: { readonly auth?: UserAPIKeyAuth }): void {
	const auth = req.auth;
	if (!auth) {
		throw ApiError.unauthorized("Missing admin auth");
	}
	if (auth.user_role !== PROXY_ADMIN_ROLE) {
		throw new ApiError(HTTP_FORBIDDEN, "Proxy admin role required");
	}
}

const DAILY_ACTIVITY_DEFAULT_PAGE = 1;
const DAILY_ACTIVITY_TOTAL_PAGES_EMPTY = 1;
/** 聚合响应最多保留的日期/主体结果数，防止标签等维度生成无界页面。 */
const DAILY_ACTIVITY_MAX_AGGREGATED_RESULTS = 10_000;
/** 聚合查询允许读取的源明细行数；一年日汇总约 3 万行，原 1 万上限会误伤 YTD。 */
const DAILY_ACTIVITY_MAX_SOURCE_ROWS = 100_000;

/**
 * 模型成本映射表原始 JSON 文本（对齐 Python `litellm.model_cost` 全量内容，
 * 构建期复制到 dist/data —— 见 package.json build 脚本）。
 * 数据源：https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 *
 * 刻意不经 JSON.parse/JSON.stringify 往返：JS Number 不区分 1 与 1.0，
 * 重新序列化会把 Python 响应中的浮点字面量（如 1.0、60.0）折叠为整数字面量，
 * 造成与 Python 响应的数值类型差异。直接透传原始文本实现字节级一致。
 * __dirname 布局：dist/proxy → ../data（生产）；src/proxy → ../data（ts-jest）。
 */
/** 内置默认 logo（Python litellm/proxy/logo.jpg 复刻） */
const DEFAULT_LOGO: Buffer = fs.readFileSync(path.join(__dirname, "..", "data", "logo.jpg"));

/** get_image 内存缓存（对齐 Python cached_logo.jpg 语义：进程生命周期内缓存一次下载结果） */
let cachedLogo: { readonly url: string; readonly body: Buffer } | null = null;

/**
 * 解析 logo 图片内容（对齐 Python get_image 优先级与回退链）：
 * UI_LOGO_PATH env > DB ui_theme_config.logo_url > 默认 logo；
 * HTTP/HTTPS URL 下载成功即缓存，下载失败回退默认 logo。
 */
async function resolveLogoImage(): Promise<Buffer> {
	const litellmSettings = await dbConfigProvider.getParam("litellm_settings");
	const themeConfig = isRecord(litellmSettings["ui_theme_config"]) ? litellmSettings["ui_theme_config"] : {};
	const dbLogoUrl = typeof themeConfig["logo_url"] === "string" ? themeConfig["logo_url"] : null;
	const logoPath = process.env.UI_LOGO_PATH ?? dbLogoUrl;

	if (logoPath && logoPath.startsWith("http://") === false && logoPath.startsWith("https://") === false) {
		// 本地路径（对齐 Python FileResponse 行为）；不存在则回退默认
		if (fs.existsSync(logoPath)) {
			return fs.readFileSync(logoPath);
		}
		return DEFAULT_LOGO;
	}

	if (logoPath) {
		if (cachedLogo && cachedLogo.url === logoPath) {
			return cachedLogo.body;
		}
		try {
			const response = await fetch(logoPath, { signal: AbortSignal.timeout(5_000) });
			const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
			if (response.ok && contentType.startsWith("image/")) {
				const body = Buffer.from(await response.arrayBuffer());
				cachedLogo = { url: logoPath, body: body };
				return body;
			}
		} catch {
			// 下载失败回退默认 logo（对齐 Python 异常路径）
		}
	}
	return DEFAULT_LOGO;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * /config/update 请求体（对齐 Python ConfigYAML，proxy/_types.py:2294）。
 * 模型只经 LiteLLM_ProxyModelTable 与管理接口维护，请求体中的 model_list 不解析。
 */
interface ConfigUpdateRequestBody {
	readonly general_settings?: Record<string, unknown>;
	readonly litellm_settings?: Record<string, unknown>;
	readonly router_settings?: Record<string, unknown>;
	readonly environment_variables?: Record<string, unknown>;
}

/** /config/update 支持写入 DB 的配置段 */
const CONFIG_UPDATE_SECTIONS = ["general_settings", "litellm_settings", "router_settings", "environment_variables"] as const;

/**
 * 配置段深合并（对齐 Python update_config 的"合并不是整段替换"语义）：
 * 嵌套对象递归合并，数组/标量由 override 整体替换。
 * @param base - 现有 DB 值
 * @param override - 请求携带的新值（优先）
 */
function deepMergeConfigValue(base: unknown, override: unknown): unknown {
	if (isRecord(base) && isRecord(override)) {
		const merged: Record<string, unknown> = { ...base };
		for (const [key, value] of Object.entries(override)) {
			merged[key] = deepMergeConfigValue(base[key], value);
		}
		return merged;
	}
	return override;
}

/**
 * 有效 general_settings：yaml 原值为底，DB 值覆盖（对齐 Python get_config 的 DB 优先语义）。
 * 每次调用都直接查询数据库，因此写入或外部 DB 修改会在下一次读取时生效。
 * @param config - 服务配置
 */
async function getEffectiveGeneralSettings(config: ServiceConfig): Promise<Record<string, unknown>> {
	const fileSettings = config.generalSettingsRaw ?? {};
	const dbSettings = await dbConfigProvider.getParam("general_settings");
	return { ...fileSettings, ...dbSettings };
}

/**
 * Python ConfigGeneralSettings 字段名白名单（proxy/_types.py:2136-2293），
 * /config/field/update 与 /config/field/delete 校验 field_name 合法性用。
 */
const CONFIG_GENERAL_SETTINGS_FIELD_NAMES: ReadonlySet<string> = new Set([
	"completion_model",
	"key_management_system",
	"use_google_kms",
	"use_azure_key_vault",
	"master_key",
	"database_url",
	"database_connection_pool_limit",
	"database_connection_timeout",
	"database_type",
	"database_args",
	"otel",
	"custom_auth",
	"max_parallel_requests",
	"global_max_parallel_requests",
	"max_request_size_mb",
	"max_response_size_mb",
	"infer_model_from_keys",
	"background_health_checks",
	"health_check_interval",
	"health_check_concurrency",
	"alerting",
	"alert_types",
	"alert_to_webhook_url",
	"alerting_args",
	"alerting_threshold",
	"ui_access_mode",
	"allowed_routes",
	"reject_clientside_metadata_tags",
	"enable_public_model_hub",
	"pass_through_endpoints",
	"user_header_name",
	"user_header_mappings",
	"supported_db_objects",
	"user_mcp_management_mode",
	"store_prompts_in_spend_logs",
	"store_upstream_logs_in_spend_logs",
	"maximum_spend_logs_retention_period",
	"mcp_internal_ip_ranges",
	"mcp_trusted_proxy_ranges",
	"store_model_in_db",
	"forward_client_headers_to_llm_api",
	"mcp_required_fields",
	"websearch_override_target_model",
]);

/**
 * /config/field/update 与 /config/field/delete 请求体（对齐 Python ConfigFieldUpdate /
 * ConfigFieldDelete，proxy/_types.py:2081-2091）。
 */
interface ConfigFieldRequestBody {
	readonly field_name?: unknown;
	readonly field_value?: unknown;
	readonly config_type?: unknown;
}

/**
 * 校验 /config/field/* 请求体，返回合法的 field_name。
 * 缺字段 → 422 FastAPI 风格；config_type 非 "general_settings" → 422 literal_error；
 * field_name 不在 ConfigGeneralSettings 白名单 → 400 {detail:{error}}（对齐 Python HTTPException）。
 * @param body - 请求体
 * @throws ApiError 422（缺字段/非法 config_type）或 400（非法 field_name）
 */
function parseConfigFieldRequest(body: ConfigFieldRequestBody): string {
	if (typeof body.field_name !== "string" || body.field_name.length === 0) {
		throw ApiError.unprocessableEntity([{ loc: ["body", "field_name"], msg: "Field required", type: "missing" }]);
	}
	if (body.config_type === undefined) {
		throw ApiError.unprocessableEntity([{ loc: ["body", "config_type"], msg: "Field required", type: "missing" }]);
	}
	if (body.config_type !== "general_settings") {
		throw ApiError.unprocessableEntity([
			{ loc: ["body", "config_type"], msg: "Input should be 'general_settings'", type: "literal_error" },
		]);
	}
	if (!CONFIG_GENERAL_SETTINGS_FIELD_NAMES.has(body.field_name)) {
		throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: `Invalid field=${body.field_name} passed in.` });
	}
	return body.field_name;
}

/** WebUI 支持的用户角色（对齐 Python LiteLLM internal user role 字符串）。 */
enum WebUiUserRole {
	PROXY_ADMIN = PROXY_ADMIN_ROLE,
	PROXY_ADMIN_VIEWER = "proxy_admin_viewer",
	INTERNAL_USER = "internal_user",
	INTERNAL_USER_VIEWER = "internal_user_viewer",
}

const WEB_UI_AVAILABLE_ROLES: Record<WebUiUserRole, AvailableRoleInfo> = {
	[WebUiUserRole.PROXY_ADMIN]: {
		description: "admin over litellm proxy, has all permissions",
		ui_label: "Admin (All Permissions)",
	},
	[WebUiUserRole.PROXY_ADMIN_VIEWER]: {
		description: "view all keys, view all spend",
		ui_label: "Admin (View Only)",
	},
	[WebUiUserRole.INTERNAL_USER]: {
		description: "view/create/delete their own keys, view their own spend",
		ui_label: "Internal User (Create/Delete/View)",
	},
	[WebUiUserRole.INTERNAL_USER_VIEWER]: {
		description: "view their own keys, view their own spend",
		ui_label: "Internal User (View Only)",
	},
};

/** Usage 页面每日活动指标。 */
interface DailyActivityMetrics {
	spend: number;
	prompt_tokens: number;
	completion_tokens: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
	total_tokens: number;
	successful_requests: number;
	failed_requests: number;
	api_requests: number;
}

interface DailyActivityRow {
	readonly date: string;
	readonly api_key: string;
	readonly model: string | null;
	readonly model_group: string | null;
	readonly custom_llm_provider: string | null;
	readonly mcp_namespaced_tool_name: string | null;
	readonly endpoint: string | null;
	readonly prompt_tokens: number | null;
	readonly completion_tokens: number | null;
	readonly cache_read_input_tokens: number | null;
	readonly cache_creation_input_tokens: number | null;
	readonly spend: number | null;
	readonly api_requests: number | null;
	readonly successful_requests: number | null;
	readonly failed_requests: number | null;
	/** Usage 账号维度：`subscription:<id>` / `credential:<name>` / `key:<hash>` / `unattributed`。 */
	readonly upstream_account_key?: string | null;
	/** 账号种类；unassociated/unattributed 时为空。 */
	readonly upstream_account_kind?: string | null;
	/** 订阅账号 ID 或 Credential 名。 */
	readonly upstream_account_id?: string | null;
	/** 该分组命中的一个 key 指纹，仅用于调试/兜底。 */
	readonly upstream_key_hash?: string | null;
	/** 该分组在本区间内实际出现的全部 key 指纹。 */
	readonly upstream_key_hashes?: readonly string[];
	readonly [key: string]: unknown;
}

interface DailyActivityRouteConfig {
	readonly entityField: DailyActivityEntityField;
	readonly filterParam: string;
	readonly singleFilterParam?: string;
	readonly excludeFilterParam?: string;
}

interface DailyActivityKeyMetadata extends Record<string, unknown> {
	readonly key_alias: string | null;
	readonly key_name: string | null;
	readonly team_id: string | null;
}

type DailyActivityKeyMetadataMap = ReadonlyMap<string, DailyActivityKeyMetadata>;

interface DailyActivityBreakdownEntry {
	readonly metrics: DailyActivityMetrics;
	readonly metadata: Record<string, unknown>;
	readonly api_key_breakdown: Record<string, DailyActivityBreakdownEntry>;
}

interface DailyActivityMetadata {
	readonly total_spend: number;
	readonly total_prompt_tokens: number;
	readonly total_completion_tokens: number;
	readonly total_tokens: number;
	readonly total_api_requests: number;
	readonly total_successful_requests: number;
	readonly total_failed_requests: number;
	readonly total_cache_read_input_tokens: number;
	readonly total_cache_creation_input_tokens: number;
	readonly total_pages: number;
	readonly has_more: boolean;
	readonly page: number;
}

interface DailyActivityResponse {
	readonly results: Array<{
		readonly date: string;
		readonly metrics: DailyActivityMetrics;
		readonly breakdown: {
			readonly mcp_servers: Record<string, DailyActivityBreakdownEntry>;
			readonly models: Record<string, DailyActivityBreakdownEntry>;
			readonly model_groups: Record<string, DailyActivityBreakdownEntry>;
			readonly providers: Record<string, DailyActivityBreakdownEntry>;
			readonly endpoints: Record<string, DailyActivityBreakdownEntry>;
			readonly api_keys: Record<string, DailyActivityBreakdownEntry>;
			readonly entities: Record<string, DailyActivityBreakdownEntry>;
		};
	}>;
	readonly metadata: DailyActivityMetadata;
}

/** Usage 页面按需加载的聚合维度；full 保留原响应供旧客户端与导出使用。 */
type DailyActivityDetailView =
	| "models"
	| "model_groups"
	| "providers"
	| "api_keys"
	| "mcp_servers"
	| "endpoints"
	| "entities"
	| "upstream_accounts";

type DailyActivityView = "full" | "summary" | DailyActivityDetailView;

interface DailyActivityDayMetrics {
	readonly date: string;
	readonly metrics: DailyActivityMetrics;
}

interface DailyActivityDimensionItem {
	readonly key: string;
	readonly metrics: DailyActivityMetrics;
	readonly metadata?: Record<string, unknown>;
}

interface DailyActivityDetailItem extends DailyActivityDimensionItem {
	readonly daily: DailyActivityDayMetrics[];
	readonly top_api_keys?: DailyActivityDimensionItem[];
	readonly top_models?: DailyActivityDimensionItem[];
}

interface DailyActivitySummaryResponse {
	readonly view: "summary";
	readonly results: DailyActivityDayMetrics[];
	readonly dimensions: {
		readonly models: DailyActivityDimensionItem[];
		readonly model_groups: DailyActivityDimensionItem[];
		readonly providers: DailyActivityDimensionItem[];
		readonly api_keys: DailyActivityDimensionItem[];
		readonly mcp_servers: DailyActivityDimensionItem[];
		readonly endpoints: DailyActivityDimensionItem[];
		readonly entities: DailyActivityDimensionItem[];
	};
	readonly metadata: DailyActivityMetadata;
}

interface DailyActivityDetailResponse {
	readonly view: DailyActivityDetailView;
	readonly results: DailyActivityDayMetrics[];
	readonly items: DailyActivityDetailItem[];
	readonly metadata: DailyActivityMetadata & {
		readonly total_count: number;
	};
}

type DailyActivityResponsePayload = DailyActivityResponse | DailyActivitySummaryResponse | DailyActivityDetailResponse;

function makeDailyActivityMetrics(): DailyActivityMetrics {
	return {
		spend: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 0,
		total_tokens: 0,
		successful_requests: 0,
		failed_requests: 0,
		api_requests: 0,
	};
}

function addDailyActivityMetrics(metrics: DailyActivityMetrics, row: DailyActivityRow): void {
	const promptTokens = row.prompt_tokens ?? 0;
	const completionTokens = row.completion_tokens ?? 0;
	metrics.spend += row.spend ?? 0;
	metrics.prompt_tokens += promptTokens;
	metrics.completion_tokens += completionTokens;
	metrics.cache_read_input_tokens += row.cache_read_input_tokens ?? 0;
	metrics.cache_creation_input_tokens += row.cache_creation_input_tokens ?? 0;
	metrics.total_tokens += promptTokens + completionTokens;
	metrics.successful_requests += row.successful_requests ?? 0;
	metrics.failed_requests += row.failed_requests ?? 0;
	metrics.api_requests += row.api_requests ?? 0;
}

function makeDailyActivityKeyMetadata(
	keyAlias: string | null = null,
	keyName: string | null = null,
	teamId: string | null = null,
): DailyActivityKeyMetadata {
	return { key_alias: keyAlias, key_name: keyName, team_id: teamId };
}

function makeDailyActivityBreakdownEntry(metadata: Record<string, unknown> = {}): DailyActivityBreakdownEntry {
	return { metrics: makeDailyActivityMetrics(), metadata: metadata, api_key_breakdown: {} };
}

function getDailyActivityKeyMetadata(metadataMap: DailyActivityKeyMetadataMap, apiKey: string): DailyActivityKeyMetadata {
	return metadataMap.get(apiKey) ?? makeDailyActivityKeyMetadata();
}

function addDailyActivityBreakdown(
	breakdown: DailyActivityResponse["results"][number]["breakdown"],
	row: DailyActivityRow,
	entityField: DailyActivityEntityField,
	keyMetadataMap: DailyActivityKeyMetadataMap,
): void {
	const keyMetadata = getDailyActivityKeyMetadata(keyMetadataMap, row.api_key);
	const apiKeyEntry = breakdown.api_keys[row.api_key] ?? makeDailyActivityBreakdownEntry(keyMetadata);
	addDailyActivityMetrics(apiKeyEntry.metrics, row);
	breakdown.api_keys[row.api_key] = apiKeyEntry;

	const dimensions: ReadonlyArray<readonly [Exclude<keyof typeof breakdown, "api_keys">, string | null]> = [
		["models", row.model],
		["model_groups", row.model_group],
		["providers", row.custom_llm_provider],
		["mcp_servers", row.mcp_namespaced_tool_name],
		["endpoints", row.endpoint],
		["entities", typeof row[entityField] === "string" ? row[entityField] : null],
	];
	for (const [dimension, value] of dimensions) {
		if (!value) {
			continue;
		}
		const entries = breakdown[dimension];
		const entry = entries[value] ?? makeDailyActivityBreakdownEntry();
		addDailyActivityMetrics(entry.metrics, row);
		const nestedKeyEntry = entry.api_key_breakdown[row.api_key] ?? makeDailyActivityBreakdownEntry(keyMetadata);
		addDailyActivityMetrics(nestedKeyEntry.metrics, row);
		entry.api_key_breakdown[row.api_key] = nestedKeyEntry;
		entries[value] = entry;
	}
}

function parseDailyActivityList(value: unknown): string[] {
	if (typeof value !== "string" || value.length === 0) {
		return [];
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseDailyActivityPage(value: unknown, fallback: number): number {
	const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 把请求参数折算成 Usage 查询的过滤条件，并在这里完成鉴权范围裁剪。
 *
 * 权限判断留在业务层：仓储只接收「已限定的实体或 Key」。管理员之外的角色按维度锁定
 * 自己的用户/团队/组织；都没有时退到「只看自己的 Key」，再没有则拒绝请求。
 * @param config - 当前 Usage 路由的实体配置
 * @param req - HTTP 请求及认证主体
 * @param startDate - 起始日（含）
 * @param endDate - 结束日
 * @param endExclusive - true 时只取 endDate 之前
 * @throws {ApiError} 未认证或没有可用 Usage 范围时拒绝查询
 */
function buildDailyActivityFilters(
	config: DailyActivityRouteConfig,
	req: DailyActivityRequest,
	startDate: string,
	endDate: string,
	endExclusive: boolean,
): DailyActivityFilters {
	const auth = req.auth;
	if (!auth) {
		throw ApiError.unauthorized("Authentication required");
	}
	let authScope: DailyActivityAuthScope | undefined;
	if (!isUsageAdmin(auth)) {
		if (config.entityField === "user_id" && auth.user_id) {
			authScope = { entityId: auth.user_id };
		} else if (config.entityField === "team_id" && auth.team_id) {
			authScope = { entityId: auth.team_id };
		} else if (config.entityField === "organization_id" && auth.user_role === "org_admin" && auth.organization_id) {
			authScope = { entityId: auth.organization_id };
		} else if (auth.token) {
			authScope = { apiKey: auth.token };
		} else {
			throw ApiError.forbidden("No accessible usage scope");
		}
	}
	const singleEntityId = config.singleFilterParam ? req.query[config.singleFilterParam] : undefined;
	const search = req.query["api_key_search"] ?? req.query["key_alias"] ?? req.query["q"];
	const model = req.query["model"];
	return {
		startDate: startDate,
		endDate: endDate,
		endExclusive: endExclusive,
		authScope: authScope,
		entityIds: parseDailyActivityList(req.query[config.filterParam]),
		singleEntityId: typeof singleEntityId === "string" && singleEntityId.length > 0 ? singleEntityId : undefined,
		excludeEntityIds: config.excludeFilterParam ? parseDailyActivityList(req.query[config.excludeFilterParam]) : [],
		model: typeof model === "string" && model.length > 0 ? model : undefined,
		apiKeys: parseDailyActivityList(req.query["api_key"]),
		// 与 Python `ui_view` 一致保留 LIKE 包含匹配；转义用户输入里的通配符。
		keySearchPattern: typeof search === "string" && search.trim() ? `%${search.trim().replace(/[\\%_]/g, "\\$&")}%` : undefined,
	};
}

/**
 * 读取密钥别名/名称元数据；别名解析失败只降级 metadata，不影响 Usage 页面。
 * @param db - 数据库连接
 * @param rows - 已聚合的 Usage 行
 */
async function loadDailyActivityKeyMetadata(db: DrizzleDb, rows: readonly DailyActivityRow[]): Promise<DailyActivityKeyMetadataMap> {
	const apiKeys = [...new Set(rows.map((row) => row.api_key).filter((apiKey) => apiKey.length > 0))];
	const metadataMap = new Map<string, DailyActivityKeyMetadata>();
	if (apiKeys.length === 0) {
		return metadataMap;
	}

	const repository = webUiSupportRepositoryFor(db);
	const activeRows = await repository.listActiveKeyMetadata(apiKeys);
	for (const row of activeRows) {
		metadataMap.set(row.token, makeDailyActivityKeyMetadata(row.keyAlias, row.keyName, row.teamId));
	}

	const missingApiKeys = apiKeys.filter((apiKey) => !metadataMap.has(apiKey));
	if (missingApiKeys.length === 0) {
		return metadataMap;
	}
	try {
		const deletedRows = await repository.listDeletedKeyMetadata(missingApiKeys);
		for (const row of deletedRows) {
			if (!metadataMap.has(row.token)) {
				metadataMap.set(row.token, makeDailyActivityKeyMetadata(row.keyAlias, row.keyName, row.teamId));
			}
		}
	} catch (error) {
		logger.warn("Daily Activity deleted key metadata 查询失败，使用 null metadata 降级", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return metadataMap;
}

/**
 * 本地时区路径：按调用方日历从原始日志聚合。
 * @param db - 数据库连接
 * @param config - 当前 Usage 路由的实体配置
 * @param req - HTTP 请求及认证主体
 * @param timezone - 已解析的浏览器时区
 * @param range - 本地日期范围与视图投影开关
 */
async function loadLocalDailyActivityRows(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	req: DailyActivityRequest,
	timezone: DailyActivityTimezone,
	range: {
		readonly startDay: string;
		readonly endDay: string;
		readonly includeEndpoint: boolean;
		readonly includeUpstreamAccount: boolean;
	},
): Promise<DailyActivityRow[]> {
	const filters = buildDailyActivityFilters(config, req, range.startDay, range.endDay, false);
	const rows = await webUiSupportRepositoryFor(db).listLocalDailyActivityRows(config.entityField, filters, {
		timezone: timezone,
		includeEndpoint: range.includeEndpoint,
		includeUpstreamAccount: range.includeUpstreamAccount,
	});
	return rows.map((row) => toDailyActivityRow(config, row));
}

/**
 * 原始日志已覆盖的最早本地日期；没有原始日志时返回 null。
 * @param db - 数据库连接
 * @param timezone - 已解析的请求时区
 */
async function loadRawCoverageLocalDay(db: DrizzleDb, timezone: DailyActivityTimezone): Promise<string | null> {
	const first = await webUiSupportRepositoryFor(db).readRawCoverageFirstTimestamp();
	return first ? localDateForTimestamp(first, timezone) : null;
}

/**
 * 读取原始日志覆盖之前的历史日汇总行。
 * @param db - 数据库连接
 * @param config - 当前 Usage 路由的实体配置
 * @param req - HTTP 请求及认证主体
 * @param startDate - 起始日（含）
 * @param beforeDay - 只取该日之前的日汇总行
 * @param options - 分页参数
 */
async function loadDailyActivityFallbackRows(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	req: DailyActivityRequest,
	startDate: string,
	beforeDay: string,
	options: { readonly limit: number; readonly offset?: number },
): Promise<DailyActivityRow[]> {
	const filters = buildDailyActivityFilters(config, req, startDate, beforeDay, true);
	const rows = await webUiSupportRepositoryFor(db).listDailyActivityRows(config.entityField, filters, options);
	return rows as unknown as DailyActivityRow[];
}

/**
 * 统计原始日志覆盖之前的历史日汇总行数。
 * @param db - 数据库连接
 * @param config - 当前 Usage 路由的实体配置
 * @param req - HTTP 请求及认证主体
 * @param startDate - 起始日（含）
 * @param beforeDay - 只统计该日之前的日汇总行
 */
async function countDailyActivityFallbackRows(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	req: DailyActivityRequest,
	startDate: string,
	beforeDay: string,
): Promise<number> {
	const filters = buildDailyActivityFilters(config, req, startDate, beforeDay, true);
	return webUiSupportRepositoryFor(db).countDailyActivityRows(config.entityField, filters);
}

function aggregateDailyActivityRows(
	rows: readonly DailyActivityRow[],
	entityField: DailyActivityEntityField,
	keyMetadataMap: DailyActivityKeyMetadataMap,
): DailyActivityResponse["results"] {
	const grouped = new Map<string, DailyActivityResponse["results"][number]>();
	for (const row of rows) {
		let daily = grouped.get(row.date);
		if (!daily) {
			daily = {
				date: row.date,
				metrics: makeDailyActivityMetrics(),
				breakdown: {
					mcp_servers: {},
					models: {},
					model_groups: {},
					providers: {},
					endpoints: {},
					api_keys: {},
					entities: {},
				},
			};
			grouped.set(row.date, daily);
		}
		addDailyActivityMetrics(daily.metrics, row);
		addDailyActivityBreakdown(daily.breakdown, row, entityField, keyMetadataMap);
	}
	return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

interface DailyActivityRequest {
	readonly query: Record<string, unknown>;
	readonly auth?: UserAPIKeyAuth;
}

/** 本地时区原始日志聚合的范围与投影开关。 */
interface DailyActivityLocalQueryOptions {
	/** 本地起始日（含）。 */
	readonly startDay: string;
	/** 本地结束日（含）。 */
	readonly endDay: string;
	/** 是否投影 endpoint 小列。 */
	readonly includeEndpoint: boolean;
	/** 是否 join 上游账号关联表并返回账号维度。 */
	readonly includeUpstreamAccount: boolean;
}

/**
 * `jsonb_agg` 返回的 key 指纹数组；驱动参数差异由字符串兜底，非法项直接丢弃。
 * @param value - 查询结果中的 upstream_key_hashes
 */
function parseDailyActivityKeyHashes(value: unknown): readonly string[] {
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/**
 * 把 PostgreSQL 的 numeric/bigint 字符串字段收敛为接口需要的数字。
 * @param config - 当前 Usage 路由的实体配置
 * @param value - 原始查询结果行
 */
function toDailyActivityRow(config: DailyActivityRouteConfig, value: Record<string, unknown>): DailyActivityRow {
	const number = (item: unknown): number => Number(item ?? 0);
	return {
		date: String(value["date"]),
		api_key: String(value["api_key"] ?? ""),
		model: value["model"] === null ? null : String(value["model"] ?? ""),
		model_group: value["model_group"] === null ? null : String(value["model_group"] ?? ""),
		custom_llm_provider: value["custom_llm_provider"] === null ? null : String(value["custom_llm_provider"] ?? ""),
		mcp_namespaced_tool_name: value["mcp_namespaced_tool_name"] === null ? null : String(value["mcp_namespaced_tool_name"] ?? ""),
		endpoint: value["endpoint"] === null ? null : String(value["endpoint"] ?? ""),
		prompt_tokens: number(value["prompt_tokens"]),
		completion_tokens: number(value["completion_tokens"]),
		cache_read_input_tokens: number(value["cache_read_input_tokens"]),
		cache_creation_input_tokens: number(value["cache_creation_input_tokens"]),
		spend: number(value["spend"]),
		api_requests: number(value["api_requests"]),
		successful_requests: number(value["successful_requests"]),
		failed_requests: number(value["failed_requests"]),
		upstream_account_key: value["upstream_account_key"] === null ? null : String(value["upstream_account_key"] ?? ""),
		upstream_account_kind: value["upstream_account_kind"] === null ? null : String(value["upstream_account_kind"] ?? ""),
		upstream_account_id: value["upstream_account_id"] === null ? null : String(value["upstream_account_id"] ?? ""),
		upstream_key_hash: value["upstream_key_hash"] === null ? null : String(value["upstream_key_hash"] ?? ""),
		upstream_key_hashes: parseDailyActivityKeyHashes(value["upstream_key_hashes"]),
		[config.entityField]: value[config.entityField] ?? null,
	} as DailyActivityRow;
}

/**
 * 合并两类来源后保持日期倒序，与日汇总路径的排序一致。
 * @param rows - 待排序的 Usage 行
 */
function sortDailyActivityRows(rows: readonly DailyActivityRow[]): DailyActivityRow[] {
	return [...rows].sort((left, right) => right.date.localeCompare(left.date));
}

/**
 * 清空当前视图不需要的 endpoint，避免日汇总历史行把部分 endpoint 带进 summary/detail。
 * 原始日志路径已在 SQL 中投影 NULL，这里只处理日汇总表的行。
 * @param rows - 待裁剪的 Usage 行
 */
function hideDailyActivityEndpoints(rows: readonly DailyActivityRow[]): DailyActivityRow[] {
	return rows.map((row) => ({ ...row, endpoint: null }));
}

async function buildDailyActivityResponse(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	rows: readonly DailyActivityRow[],
	options: { readonly aggregated: boolean; readonly page: number; readonly pageSize: number; readonly totalCount: number },
): Promise<DailyActivityResponse> {
	const keyMetadataMap = await loadDailyActivityKeyMetadata(db, rows);
	const results = aggregateDailyActivityRows(rows, config.entityField, keyMetadataMap);
	if (options.aggregated && results.length > DAILY_ACTIVITY_MAX_AGGREGATED_RESULTS) {
		throw ApiError.badRequest("Too many aggregated usage rows; narrow the date range or entity filters");
	}
	const totals = makeDailyActivityMetrics();
	for (const row of rows) {
		addDailyActivityMetrics(totals, row);
	}
	const totalPages = options.aggregated
		? DAILY_ACTIVITY_TOTAL_PAGES_EMPTY
		: Math.max(DAILY_ACTIVITY_TOTAL_PAGES_EMPTY, Math.ceil(options.totalCount / options.pageSize));
	return {
		results: results,
		metadata: {
			total_spend: totals.spend,
			total_prompt_tokens: totals.prompt_tokens,
			total_completion_tokens: totals.completion_tokens,
			total_tokens: totals.total_tokens,
			total_api_requests: totals.api_requests,
			total_successful_requests: totals.successful_requests,
			total_failed_requests: totals.failed_requests,
			total_cache_read_input_tokens: totals.cache_read_input_tokens,
			total_cache_creation_input_tokens: totals.cache_creation_input_tokens,
			total_pages: totalPages,
			has_more: options.aggregated ? false : options.page * options.pageSize < options.totalCount,
			page: options.page,
		},
	};
}

/** summary 保持原有 7 个维度；账号只是明细视图，不扩大 summary 契约。 */
const DAILY_ACTIVITY_SUMMARY_VIEWS = [
	"models",
	"model_groups",
	"providers",
	"api_keys",
	"mcp_servers",
	"endpoints",
	"entities",
] as const satisfies readonly Exclude<DailyActivityDetailView, "upstream_accounts">[];

const DAILY_ACTIVITY_DETAIL_VIEWS = [
	...DAILY_ACTIVITY_SUMMARY_VIEWS,
	"upstream_accounts",
] as const satisfies readonly DailyActivityDetailView[];

/**
 * 解析 Usage 的按需加载视图；缺省仍返回原来的 full 响应，保证旧客户端和导出兼容。
 * @param query - Express 查询参数
 * @throws {ApiError} view 不是受支持的值时拒绝请求
 */
function parseDailyActivityView(query: Record<string, unknown>): DailyActivityView {
	const value = query["view"];
	if (value === undefined || value === "full") {
		return "full";
	}
	if (typeof value !== "string" || ![...DAILY_ACTIVITY_DETAIL_VIEWS, "summary"].includes(value as DailyActivityView)) {
		throw ApiError.badRequest(
			"view must be one of full, summary, models, model_groups, providers, api_keys, mcp_servers, endpoints, entities, upstream_accounts",
		);
	}
	return value as DailyActivityView;
}

/**
 * 返回某个维度对应的字段值；空值不生成 breakdown，避免 UI 出现 "-" 分组。
 * @param row - 已按权限过滤的 Usage 行
 * @param dimension - 目标维度
 * @param entityField - 当前路由的主实体字段
 */
function dailyActivityDimensionValue(
	row: DailyActivityRow,
	dimension: DailyActivityDetailView,
	entityField: DailyActivityEntityField,
): string | null {
	switch (dimension) {
		case "models":
			return row.model;
		case "model_groups":
			return row.model_group;
		case "providers":
			return row.custom_llm_provider;
		case "api_keys":
			return row.api_key;
		case "mcp_servers":
			return row.mcp_namespaced_tool_name;
		case "endpoints":
			return row.endpoint;
		case "upstream_accounts":
			// 历史日汇总行没有 key 事实；缺省归到 unattributed，而不是从视图里消失。
			return row.upstream_account_key || "unattributed";
		case "entities": {
			const value = row[entityField];
			return typeof value === "string" ? value : null;
		}
		default:
			return null;
	}
}

/**
 * 生成公共 metadata；detail 的 total_count 由调用方补充。
 * @param rows - 用于汇总的明细
 * @param page - 当前页
 * @param pageSize - 每页条数
 * @param totalCount - 不分页前的总条数
 * @param totalPages - 总页数；聚合响应固定 1
 */
function makeDailyActivityMetadata(
	rows: readonly DailyActivityRow[],
	page: number,
	pageSize: number,
	totalCount: number,
	totalPages = 1,
): DailyActivityMetadata {
	const totals = makeDailyActivityMetrics();
	for (const row of rows) {
		addDailyActivityMetrics(totals, row);
	}
	return {
		total_spend: totals.spend,
		total_prompt_tokens: totals.prompt_tokens,
		total_completion_tokens: totals.completion_tokens,
		total_tokens: totals.total_tokens,
		total_api_requests: totals.api_requests,
		total_successful_requests: totals.successful_requests,
		total_failed_requests: totals.failed_requests,
		total_cache_read_input_tokens: totals.cache_read_input_tokens,
		total_cache_creation_input_tokens: totals.cache_creation_input_tokens,
		total_pages: totalPages,
		has_more: page * pageSize < totalCount,
		page: page,
	};
}

/**
 * 按本地日期汇总总量；summary 的 results 只需要 metrics，不再复制 breakdown。
 * @param rows - 已按权限过滤的 Usage 行
 */
function aggregateDailyActivityDays(rows: readonly DailyActivityRow[]): DailyActivityDayMetrics[] {
	const grouped = new Map<string, DailyActivityDayMetrics>();
	for (const row of rows) {
		const day = grouped.get(row.date) ?? { date: row.date, metrics: makeDailyActivityMetrics() };
		addDailyActivityMetrics(day.metrics, row);
		grouped.set(row.date, day);
	}
	return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function compareDailyActivityItems(left: DailyActivityDimensionItem, right: DailyActivityDimensionItem): number {
	return right.metrics.spend - left.metrics.spend || left.key.localeCompare(right.key);
}

/**
 * 聚合一个维度的全区间总量；summary 用它生成 Top Model/Provider/Key 的排序输入。
 * @param rows - 已按权限过滤的 Usage 行
 * @param dimension - 目标维度
 * @param entityField - 当前路由的主实体字段
 * @param keyMetadataMap - Key 别名/团队元数据
 */
function aggregateDailyActivityDimensionTotals(
	rows: readonly DailyActivityRow[],
	dimension: DailyActivityDetailView,
	entityField: DailyActivityEntityField,
	keyMetadataMap: DailyActivityKeyMetadataMap,
): DailyActivityDimensionItem[] {
	const grouped = new Map<string, { metrics: DailyActivityMetrics; metadata?: Record<string, unknown> }>();
	for (const row of rows) {
		const key = dailyActivityDimensionValue(row, dimension, entityField);
		if (!key) {
			continue;
		}
		const item = grouped.get(key) ?? {
			metrics: makeDailyActivityMetrics(),
			metadata: dimension === "api_keys" ? getDailyActivityKeyMetadata(keyMetadataMap, key) : undefined,
		};
		addDailyActivityMetrics(item.metrics, row);
		grouped.set(key, item);
	}
	return [...grouped.entries()]
		.map(([key, item]) => ({ key: key, metrics: item.metrics, metadata: item.metadata }))
		.sort(compareDailyActivityItems);
}

/**
 * 生成 summary 响应：日指标 + 各维度总量，不含逐日嵌套明细。
 * @param db - 数据库连接
 * @param config - 当前 Usage 路由配置
 * @param rows - 已合并原始日志与历史日汇总的行
 */
async function buildDailyActivitySummary(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	rows: readonly DailyActivityRow[],
): Promise<DailyActivitySummaryResponse> {
	const keyMetadataMap = await loadDailyActivityKeyMetadata(db, rows);
	const dimensions = Object.fromEntries(
		[...DAILY_ACTIVITY_SUMMARY_VIEWS].map((dimension) => [
			dimension,
			aggregateDailyActivityDimensionTotals(rows, dimension, config.entityField, keyMetadataMap),
		]),
	) as DailyActivitySummaryResponse["dimensions"];
	return {
		view: "summary",
		results: aggregateDailyActivityDays(rows),
		dimensions: dimensions,
		metadata: makeDailyActivityMetadata(rows, 1, rows.length, rows.length),
	};
}

/** Usage 账号维度展示所需的窄元数据；不包含任何密钥或完整 payload。 */
interface DailyActivityAccountMetadata extends Record<string, unknown> {
	readonly kind: "subscription" | "credential" | "unassociated" | "unattributed";
	readonly account_id: string;
	readonly label: string;
	readonly provider: string;
	readonly providers: readonly string[];
	readonly key_count: number;
	readonly sample_key_hash: string | null;
	readonly trashed: boolean;
	readonly deleted: boolean;
}

/**
 * 拆分账号分组的稳定键。
 * @param key - `subscription:<id>` / `credential:<name>` / `key:<hash>` / `unattributed`
 */
function parseUpstreamAccountKey(key: string): {
	readonly kind: "subscription" | "credential" | "key" | "unattributed";
	readonly id: string;
} {
	if (key.startsWith("subscription:")) {
		return { kind: "subscription", id: key.slice("subscription:".length) };
	}
	if (key.startsWith("credential:")) {
		return { kind: "credential", id: key.slice("credential:".length) };
	}
	if (key.startsWith("key:")) {
		return { kind: "key", id: key.slice("key:".length) };
	}
	return { kind: "unattributed", id: "" };
}

/**
 * 用当前账号表与 Credential 表补全展示 label。
 *
 * 只取 email / account_key / provider 这些窄列；订阅 payload 里有 token，绝不能整段
 * 读到 Usage 进程内存。账号或 Credential 已删除时仍保留分组，label 降级并标记。
 * @param db - 数据库连接
 * @param grouped - 按账号键聚合的 key 指纹与 provider
 */
async function loadDailyActivityAccountMetadata(
	db: DrizzleDb,
	grouped: ReadonlyMap<string, { readonly keyHashes: ReadonlySet<string>; readonly providers: ReadonlySet<string> }>,
): Promise<ReadonlyMap<string, DailyActivityAccountMetadata>> {
	const subscriptionIds = new Set<string>();
	const credentialNames = new Set<string>();
	for (const key of grouped.keys()) {
		const parsed = parseUpstreamAccountKey(key);
		if (parsed.kind === "subscription") {
			subscriptionIds.add(parsed.id);
		} else if (parsed.kind === "credential") {
			credentialNames.add(parsed.id);
		}
	}

	const subscriptions = new Map<
		string,
		{
			readonly email: string | null;
			readonly label: string | null;
			readonly accountKey: string;
			readonly provider: string;
			readonly trashed: boolean;
		}
	>();
	const credentials = new Map<string, { readonly provider: string | null }>();
	let lookupFailed = false;
	try {
		if (subscriptionIds.size > 0) {
			const rows = await webUiSupportRepositoryFor(db).listSubscriptionAccountMetadata([...subscriptionIds]);
			for (const row of rows) {
				subscriptions.set(row.id, {
					email: row.email,
					label: row.label,
					accountKey: row.accountKey,
					provider: row.provider,
					trashed: row.trashedAt !== null,
				});
			}
		}
		if (credentialNames.size > 0) {
			const rows = await credentialRepositoryFor(db).listIdentityMetadata([...credentialNames]);
			for (const row of rows) {
				credentials.set(row.name, { provider: row.provider });
			}
		}
	} catch (error) {
		// 账号维度的 label 解析失败不应让整个 Usage 页面不可用；键与花费仍可展示。
		// 此时无法判断账号是否已删除，不能把查询失败误报成 Deleted。
		lookupFailed = true;
		logger.warn("Daily Activity upstream account metadata 查询失败，使用 ID 降级", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const result = new Map<string, DailyActivityAccountMetadata>();
	for (const [key, item] of grouped) {
		const parsed = parseUpstreamAccountKey(key);
		const providers = [...item.providers].filter((provider) => provider.length > 0).sort();
		const firstProvider = providers[0] ?? "";
		const keyHashes = [...item.keyHashes].sort();
		const sampleKeyHash = keyHashes[0] ?? null;
		let kind: DailyActivityAccountMetadata["kind"] = "unattributed";
		let accountId = "";
		let label = "Not recorded";
		let provider = firstProvider;
		let trashed = false;
		let deleted = false;
		if (parsed.kind === "subscription") {
			const account = subscriptions.get(parsed.id);
			kind = "subscription";
			accountId = parsed.id;
			provider = account?.provider ?? firstProvider;
			label = subscriptionAccountDisplayName({
				email: account?.email,
				label: account?.label,
				accountKey: account?.accountKey,
				provider: provider,
				id: parsed.id,
			});
			trashed = account?.trashed ?? false;
			deleted = account === undefined && !lookupFailed;
		} else if (parsed.kind === "credential") {
			const credential = credentials.get(parsed.id);
			kind = "credential";
			accountId = parsed.id;
			provider = credential?.provider ?? firstProvider;
			label = parsed.id;
			deleted = credential === undefined && !lookupFailed;
		} else if (parsed.kind === "key") {
			kind = "unassociated";
			accountId = parsed.id;
			label = `Unassociated key ${parsed.id.slice(0, 8)}`;
		}
		result.set(key, {
			kind: kind,
			account_id: accountId,
			label: label,
			provider: providers.length > 1 ? "multiple" : provider,
			providers: providers,
			key_count: keyHashes.length,
			sample_key_hash: sampleKeyHash,
			trashed: trashed,
			deleted: deleted,
		});
	}
	return result;
}

interface MutableDailyActivityDetailItem {
	readonly metrics: DailyActivityMetrics;
	readonly daily: Map<string, DailyActivityMetrics>;
	readonly topApiKeys: Map<string, DailyActivityMetrics>;
	readonly topModels: Map<string, DailyActivityMetrics>;
	/** 该账号在区间内实际出现过的 key 指纹。 */
	readonly keyHashes: Set<string>;
	/** 该账号在区间内实际使用的 provider。 */
	readonly providers: Set<string>;
}

/**
 * 生成某一维度的分页明细；每个实体只带自身日序列和 Top 关联项，避免全维度复制。
 * @param db - 数据库连接
 * @param config - 当前 Usage 路由配置
 * @param rows - 已合并原始日志与历史日汇总的行
 * @param view - 目标维度
 * @param req - HTTP 请求，提供 entity/page/page_size
 */
async function buildDailyActivityDetail(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	rows: readonly DailyActivityRow[],
	view: DailyActivityDetailView,
	req: DailyActivityRequest,
): Promise<DailyActivityDetailResponse> {
	const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : null;
	const filteredRows = entity ? rows.filter((row) => dailyActivityDimensionValue(row, view, config.entityField) === entity) : rows;
	const keyMetadataMap = await loadDailyActivityKeyMetadata(db, filteredRows);
	const grouped = new Map<string, MutableDailyActivityDetailItem>();
	for (const row of filteredRows) {
		const key = dailyActivityDimensionValue(row, view, config.entityField);
		if (!key) {
			continue;
		}
		const item = grouped.get(key) ?? {
			metrics: makeDailyActivityMetrics(),
			daily: new Map<string, DailyActivityMetrics>(),
			topApiKeys: new Map<string, DailyActivityMetrics>(),
			topModels: new Map<string, DailyActivityMetrics>(),
			keyHashes: new Set<string>(),
			providers: new Set<string>(),
		};
		if (view === "upstream_accounts") {
			for (const hash of row.upstream_key_hashes ?? []) {
				item.keyHashes.add(hash);
			}
			if (row.upstream_key_hash) {
				item.keyHashes.add(row.upstream_key_hash);
			}
			if (row.custom_llm_provider) {
				item.providers.add(row.custom_llm_provider);
			}
		}
		addDailyActivityMetrics(item.metrics, row);
		const day = item.daily.get(row.date) ?? makeDailyActivityMetrics();
		addDailyActivityMetrics(day, row);
		item.daily.set(row.date, day);
		if (view !== "api_keys" && row.api_key) {
			const nested = item.topApiKeys.get(row.api_key) ?? makeDailyActivityMetrics();
			addDailyActivityMetrics(nested, row);
			item.topApiKeys.set(row.api_key, nested);
		}
		if ((view === "api_keys" || view === "upstream_accounts") && row.model) {
			const nested = item.topModels.get(row.model) ?? makeDailyActivityMetrics();
			addDailyActivityMetrics(nested, row);
			item.topModels.set(row.model, nested);
		}
		grouped.set(key, item);
	}
	const accountMetadata = view === "upstream_accounts" ? await loadDailyActivityAccountMetadata(db, grouped) : undefined;

	const items = [...grouped.entries()]
		.map(([key, item]) => {
			const result: DailyActivityDetailItem = {
				key: key,
				metrics: item.metrics,
				metadata: view === "api_keys" ? getDailyActivityKeyMetadata(keyMetadataMap, key) : accountMetadata?.get(key),
				daily: [...item.daily.entries()]
					.map(([date, metrics]) => ({ date: date, metrics: metrics }))
					.sort((left, right) => left.date.localeCompare(right.date)),
				top_api_keys: [...item.topApiKeys.entries()]
					.map(([nestedKey, metrics]) => ({
						key: nestedKey,
						metrics: metrics,
						metadata: getDailyActivityKeyMetadata(keyMetadataMap, nestedKey),
					}))
					.sort(compareDailyActivityItems)
					.slice(0, 10),
				top_models: [...item.topModels.entries()]
					.map(([nestedKey, metrics]) => ({ key: nestedKey, metrics: metrics }))
					.sort(compareDailyActivityItems)
					.slice(0, 10),
			};
			return result;
		})
		.sort(compareDailyActivityItems);

	const pageSize = Math.min(100, parseDailyActivityPage(req.query["page_size"], 20));
	const page = parseDailyActivityPage(req.query["page"], 1);
	const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
	const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
	const metadata = makeDailyActivityMetadata(filteredRows, page, pageSize, items.length, totalPages);
	return {
		view: view,
		results: aggregateDailyActivityDays(filteredRows),
		items: pageItems,
		metadata: { ...metadata, total_count: items.length },
	};
}

/**
 * 原始 Usage 行的缓存键。
 *
 * 缓存的是未按视图裁剪的原始行，因此必须把鉴权范围、时区和所有过滤条件都纳入键；
 * 只放行日期范围会导致不同 Key/用户之间串数据。
 * @param config - 当前 Usage 路由的实体配置
 * @param req - HTTP 请求及认证主体
 * @param timezone - 已解析的浏览器时区
 * @param options - 原始日志覆盖范围与本视图投影开关；早于覆盖范围的请求共用同一份缓存
 */
function dailyActivityRowsCacheKey(
	config: DailyActivityRouteConfig,
	req: DailyActivityRequest,
	timezone: DailyActivityTimezone,
	options: DailyActivityLocalQueryOptions,
): string {
	const auth = req.auth;
	const single = config.singleFilterParam ? req.query[config.singleFilterParam] : undefined;
	const search = req.query["api_key_search"] ?? req.query["key_alias"] ?? req.query["q"];
	return JSON.stringify([
		config.entityField,
		config.filterParam,
		config.singleFilterParam ?? "",
		config.excludeFilterParam ?? "",
		options.startDay,
		options.endDay,
		options.includeEndpoint,
		options.includeUpstreamAccount,
		timezone.name ?? "",
		timezone.offsetMinutes ?? null,
		auth?.user_role ?? "",
		auth?.user_id ?? "",
		auth?.team_id ?? "",
		auth?.organization_id ?? "",
		auth?.token ?? "",
		parseDailyActivityList(req.query[config.filterParam]).slice().sort(),
		typeof single === "string" ? single : "",
		config.excludeFilterParam ? parseDailyActivityList(req.query[config.excludeFilterParam]).slice().sort() : [],
		typeof req.query["model"] === "string" ? req.query["model"] : "",
		parseDailyActivityList(req.query["api_key"]).slice().sort(),
		typeof search === "string" ? search : "",
	]);
}

function buildDailyActivityHandler(
	db: DrizzleDb,
	config: DailyActivityRouteConfig,
	aggregated: boolean,
	rowsCache: UsageActivityCache<readonly DailyActivityRow[]>,
) {
	return async (req: DailyActivityRequest): Promise<DailyActivityResponsePayload> => {
		const startDate = typeof req.query["start_date"] === "string" ? req.query["start_date"] : null;
		const endDate = typeof req.query["end_date"] === "string" ? req.query["end_date"] : null;
		if (!startDate || !endDate) {
			throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: "Please provide start_date and end_date" });
		}

		const range = usageDateRange(req.query);
		const timezone = parseDailyActivityTimezone(req.query);
		const view = parseDailyActivityView(req.query);
		if (view !== "full" && !aggregated) {
			throw ApiError.badRequest("view is only supported on the aggregated Usage endpoint");
		}
		if (view === "upstream_accounts" && (!req.auth || !isUsageAdmin(req.auth))) {
			// 上游账号是跨 Key 的供应商身份，不能暴露给普通 Key 的使用者。
			throw new ApiError(HTTP_FORBIDDEN, "Upstream account view requires admin access");
		}
		if (view === "upstream_accounts" && !timezone) {
			// 历史日汇总表没有 key 事实，无法回填账号；拒绝比返回一半错误数据更安全。
			throw ApiError.badRequest("Upstream account view requires a timezone");
		}
		const page = aggregated ? DAILY_ACTIVITY_DEFAULT_PAGE : parseDailyActivityPage(req.query["page"], DAILY_ACTIVITY_DEFAULT_PAGE);
		const pageSize = Math.min(1000, parseDailyActivityPage(req.query["page_size"], 50));
		// endpoint 已由 0019 迁移投影为小列；仍只在 Endpoint 页和完整导出返回该维度，
		// summary/其它明细页保持 NULL，既维持现有 API 契约也减少返回宽度。
		const includeEndpoint = !aggregated || view === "endpoints" || view === "full";
		const includeUpstreamAccount = aggregated && view === "upstream_accounts";

		if (timezone) {
			// 原始日志从 TS 服务开始写入时才有数据；早于它覆盖范围的历史交给日汇总表。
			// 缓存按实际原始查询范围命中：7 天、30 天和 YTD 都以同一份近期原始行开始，
			// 切换时间范围时不需要重新扫描 SpendLogs。
			const firstRawDay = await loadRawCoverageLocalDay(db, timezone);
			const rawStartDay = firstRawDay && range.startDay <= firstRawDay ? firstRawDay : range.startDay;
			const hasRawRange = firstRawDay === null || rawStartDay <= range.endDay;
			const rawRows = hasRawRange
				? await rowsCache.get(
						dailyActivityRowsCacheKey(config, req, timezone, {
							startDay: rawStartDay,
							endDay: range.endDay,
							includeEndpoint: includeEndpoint,
							includeUpstreamAccount: includeUpstreamAccount,
						}),
						() =>
							loadLocalDailyActivityRows(db, config, req, timezone, {
								startDay: rawStartDay,
								endDay: range.endDay,
								includeEndpoint: includeEndpoint,
								includeUpstreamAccount: includeUpstreamAccount,
							}),
					)
				: [];
			const rows = rawStartDay === range.startDay ? rawRows : rawRows.filter((row) => row.date >= range.startDay);
			// 原始日志表完全为空、或请求整段早于原始覆盖时，全部走日汇总历史。
			const fallbackBefore =
				firstRawDay === null || firstRawDay > range.endDay
					? nextCalendarDay(range.endDay)
					: range.startDay < rawStartDay
						? rawStartDay
						: null;
			if (aggregated) {
				const fallbackRows = fallbackBefore
					? await loadDailyActivityFallbackRows(db, config, req, range.startDay, fallbackBefore, {
							limit: DAILY_ACTIVITY_MAX_SOURCE_ROWS + 1,
						})
					: [];
				const combined = sortDailyActivityRows([
					...rows,
					...(includeEndpoint ? fallbackRows : hideDailyActivityEndpoints(fallbackRows)),
				]);
				if (combined.length > DAILY_ACTIVITY_MAX_SOURCE_ROWS) {
					throw ApiError.badRequest("Too many usage rows; narrow the date range or entity filters");
				}
				if (view === "summary") {
					return buildDailyActivitySummary(db, config, combined);
				}
				if (view !== "full") {
					return buildDailyActivityDetail(db, config, combined, view, req);
				}
				return buildDailyActivityResponse(db, config, combined, {
					aggregated: true,
					page: page,
					pageSize: pageSize,
					totalCount: combined.length,
				});
			}
			const fallbackCount = fallbackBefore
				? await countDailyActivityFallbackRows(db, config, req, range.startDay, fallbackBefore)
				: 0;
			const totalCount = rows.length + fallbackCount;
			const offset = (page - 1) * pageSize;
			const pageRows = rows.slice(offset, offset + pageSize);
			if (pageRows.length < pageSize && fallbackBefore) {
				const fallbackOffset = Math.max(0, offset - rows.length);
				pageRows.push(
					...(await loadDailyActivityFallbackRows(db, config, req, range.startDay, fallbackBefore, {
						limit: pageSize - pageRows.length,
						offset: fallbackOffset,
					})),
				);
			}
			return buildDailyActivityResponse(db, config, pageRows, {
				aggregated: false,
				page: page,
				pageSize: pageSize,
				totalCount: totalCount,
			});
		}

		const filters = buildDailyActivityFilters(config, req, startDate, endDate, false);
		const repository = webUiSupportRepositoryFor(db);
		const totalCount = await repository.countDailyActivityRows(config.entityField, filters);
		const selectedRows = (await repository.listDailyActivityRows(
			config.entityField,
			filters,
			aggregated ? { limit: DAILY_ACTIVITY_MAX_SOURCE_ROWS + 1 } : { limit: pageSize, offset: (page - 1) * pageSize },
		)) as unknown as DailyActivityRow[];
		const rows = includeEndpoint ? selectedRows : hideDailyActivityEndpoints(selectedRows);
		if (aggregated && rows.length > DAILY_ACTIVITY_MAX_SOURCE_ROWS) {
			throw ApiError.badRequest("Too many usage rows; narrow the date range or entity filters");
		}
		if (view === "summary") {
			return buildDailyActivitySummary(db, config, rows as unknown as DailyActivityRow[]);
		}
		if (view !== "full") {
			return buildDailyActivityDetail(db, config, rows as unknown as DailyActivityRow[], view, req);
		}
		return buildDailyActivityResponse(db, config, rows as unknown as DailyActivityRow[], {
			aggregated: aggregated,
			page: page,
			pageSize: pageSize,
			totalCount: totalCount,
		});
	};
}

/**
 * WebUI 启动偏好响应，供 dashboard 在登录前后读取默认 UI 配置。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
 */
interface UiSettingsResponse {
	readonly values: Record<string, unknown>;
	readonly field_schema: {
		readonly description: string;
		readonly properties: Record<
			string,
			{
				readonly description: string;
				readonly type: string;
				/** array 类型字段的元素 schema（对齐 Python field_schema，如 enabled_ui_pages_internal_users.items） */
				readonly items?: { readonly type: string };
			}
		>;
	};
}

interface SsoUiSettingsResponse {
	readonly PROXY_BASE_URL: string | null;
	readonly PROXY_LOGOUT_URL: string | null;
	readonly LITELLM_UI_API_DOC_BASE_URL: string | null;
	readonly DEFAULT_TEAM_DISABLED: boolean;
	readonly SSO_ENABLED: boolean;
	readonly NUM_SPEND_LOGS_ROWS: number;
	readonly DISABLE_EXPENSIVE_DB_QUERIES: boolean;
}

interface AvailableRoleInfo {
	readonly description: string;
	readonly ui_label: string;
}

/**
 * 表单字段类型（对齐 WebUI CredentialField.field_type）
 * - TEXT: 单行文本输入
 * - PASSWORD: 密码输入，UI 隐藏明文
 * - SELECT: 下拉选择（options 必填）
 * - UPLOAD: 文件上传
 * - TEXTAREA: 多行文本输入
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx CredentialField
 */
enum CredentialFieldType {
	TEXT = "text",
	PASSWORD = "password",
	SELECT = "select",
	UPLOAD = "upload",
	TEXTAREA = "textarea",
}

/**
 * `/config/list` general_settings 字段类型（对齐 Python LiteLLM
 * `litellm/proxy/proxy_server.py::get_config_list` 返回的 `field_type` 字符串）。
 * 字符串值需与 WebUI `useProxyConfig` 直接渲染的 `field_type` 字面量一致，
 * 因此保持 PascalCase 字面量（"Integer" / "Boolean" / "String" / "List" / "PydanticModel"），
 * 不可改为 lowercase。
 * - INTEGER: 整型配置（如 max_parallel_requests、max_request_size_mb）
 * - BOOLEAN: 布尔配置（如 store_model_in_db、always_include_stream_usage）
 * - STRING: 字符串配置（如 maximum_spend_logs_retention_period）
 * - LIST: 列表配置（如 mcp_internal_ip_ranges）
 * - PYDANTIC_MODEL: 复杂结构配置（如 pass_through_endpoints）
 * @see https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py get_config_list
 */
enum ConfigFieldType {
	INTEGER = "Integer",
	BOOLEAN = "Boolean",
	STRING = "String",
	LIST = "List",
	PYDANTIC_MODEL = "PydanticModel",
}

/**
 * Provider 凭据字段元数据：WebUI 用它渲染 Add Model / Credentials 表单。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx ProviderCreateInfo
 */
interface ProviderCredentialFieldMetadata {
	readonly key: string;
	readonly label: string;
	readonly placeholder?: string | null;
	readonly tooltip?: string | null;
	readonly required?: boolean;
	readonly field_type?: CredentialFieldType;
	readonly options?: string[] | null;
	readonly default_value?: string | null;
}

/**
 * Provider 创建表单描述，返回给 WebUI provider 字段发现接口。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx ProviderCreateInfo
 */
interface ProviderCreateInfo {
	readonly provider: string;
	readonly provider_display_name: string;
	readonly litellm_provider: string;
	readonly default_model_placeholder?: string | null;
	readonly credential_fields: ProviderCredentialFieldMetadata[];
}

/**
 * Provider 凭据字段清单（与 Python `litellm/proxy/public_endpoints/provider_create_fields.json`
 * 同数据，109 个 provider），经 /public/providers/fields 返回。
 * JSON 中 field_type 为字符串字面量，与 CredentialFieldType 值一致，此处断言为枚举类型。
 */
const PROVIDER_CREATE_FIELDS: readonly ProviderCreateInfo[] = [
	...(providerCreateFieldsJson as unknown as ProviderCreateInfo[]),
	...Object.entries(SUBSCRIPTION_PROVIDERS).map(([slug, info]) => ({
		provider: info.name,
		provider_display_name: info.name,
		litellm_provider: slug,
		default_model_placeholder: "Select a model from your subscription",
		credential_fields: [],
	})),
];

/**
 * /active/callbacks 响应（对齐 Python active_callbacks，
 * litellm/proxy/health_endpoints/_health_endpoints.py:1184-1260）。
 * Python 各 litellm.* 列表元素为回调对象的 str()；TS 端回调以配置名表示。
 */
interface ActiveCallbacksResponse {
	readonly alerting: string;
	readonly "litellm.callbacks": readonly string[];
	readonly "litellm.input_callback": readonly string[];
	readonly "litellm.failure_callback": readonly string[];
	readonly "litellm.success_callback": readonly string[];
	readonly "litellm._async_success_callback": readonly string[];
	readonly "litellm._async_failure_callback": readonly string[];
	readonly "litellm._async_input_callback": readonly string[];
	readonly all_litellm_callbacks: readonly string[];
	readonly num_callbacks: number;
	readonly num_alerting: number;
	readonly "litellm.request_timeout": number;
}

/**
 * 从原始配置块提取字符串数组字段（缺省/非数组时返回空数组）
 * @param record
 * @param fieldName
 */
function pickStringArray(record: Record<string, unknown>, fieldName: string): string[] {
	const value = record[fieldName];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * Python str(value) 风格的 alerting 渲染：
 * 未配置 → "None"；字符串列表 → "['a', 'b']"（Python list repr，单引号）。
 * @param alerting - general_settings.alerting 原始值
 */
function renderAlertingRepr(alerting: unknown): string {
	if (alerting === undefined || alerting === null) {
		return "None";
	}
	if (Array.isArray(alerting)) {
		const items = alerting.map((item) => `'${String(item)}'`).join(", ");
		return `[${items}]`;
	}
	return String(alerting);
}

/**
 * 构造 /active/callbacks 响应。
 * Python 的 _async_* 列表为运行时注册的异步回调对象；TS 端回调全部异步执行，
 * 故 _async_* 列表镜像对应配置名（保持与 Python 相同的"配置名出现于 sync+async 列表"语义）。
 * @param config - 服务配置
 */
function buildActiveCallbacksResponse(config: ServiceConfig): ActiveCallbacksResponse {
	const litellmSettings = config.litellmSettingsRaw ?? {};
	const callbacks = pickStringArray(litellmSettings, "callbacks");
	const inputCallbacks = pickStringArray(litellmSettings, "input_callback");
	const failureCallbacks = pickStringArray(litellmSettings, "failure_callback");
	const successCallbacks = pickStringArray(litellmSettings, "success_callback");
	const asyncSuccessCallbacks = [...successCallbacks];
	const asyncFailureCallbacks = [...failureCallbacks];
	const asyncInputCallbacks = [...inputCallbacks];
	const allCallbacks = [
		...callbacks,
		...inputCallbacks,
		...failureCallbacks,
		...successCallbacks,
		...asyncSuccessCallbacks,
		...asyncFailureCallbacks,
		...asyncInputCallbacks,
	];
	const alerting = config.generalSettingsRaw?.alerting;
	return {
		alerting: renderAlertingRepr(alerting),
		"litellm.callbacks": callbacks,
		"litellm.input_callback": inputCallbacks,
		"litellm.failure_callback": failureCallbacks,
		"litellm.success_callback": successCallbacks,
		"litellm._async_success_callback": asyncSuccessCallbacks,
		"litellm._async_failure_callback": asyncFailureCallbacks,
		"litellm._async_input_callback": asyncInputCallbacks,
		all_litellm_callbacks: allCallbacks,
		num_callbacks: allCallbacks.length,
		num_alerting: Array.isArray(alerting) ? alerting.length : 0,
		// Python litellm.request_timeout 单位为秒；TS requestTimeoutMs 单位为毫秒
		"litellm.request_timeout": config.litellmSettings.requestTimeoutMs / 1000,
	};
}

const UI_SETTINGS_FIELD_SCHEMA: UiSettingsResponse["field_schema"] = {
	description: "Configuration for UI-specific flags",
	properties: {
		disable_model_add_for_internal_users: {
			description: "If true, internal users cannot add models from the UI",
			type: "boolean",
		},
		disable_team_admin_delete_team_user: {
			description:
				"Prevents Team Admins from deleting users from the teams they manage. Useful for SCIM provisioning where team membership is defined externally.",
			type: "boolean",
		},
		enabled_ui_pages_internal_users: {
			description:
				"List of page keys that internal users (non-admins) can see in the UI sidebar. If not set, all pages are visible based on role permissions.",
			type: "array",
			items: { type: "string" },
		},
		require_auth_for_public_ai_hub: {
			description: "If true, requires authentication for accessing the public AI Hub.",
			type: "boolean",
		},
		forward_client_headers_to_llm_api: {
			description:
				"If enabled, forwards client headers (e.g. Authorization) to the LLM API. Required for Claude Code with Max subscription.",
			type: "boolean",
		},
		enable_projects_ui: {
			description: "If enabled, shows the Projects feature in the UI sidebar and the project field in key management.",
			type: "boolean",
		},
		disable_agents_for_internal_users: {
			description: "If true, internal users cannot access agent management endpoints or the Agents page in the UI.",
			type: "boolean",
		},
		allow_agents_for_team_admins: {
			description:
				"If true, team admins are exempt from the agents disable restriction (only takes effect when disable_agents_for_internal_users is true).",
			type: "boolean",
		},
		disable_vector_stores_for_internal_users: {
			description: "If true, internal users cannot access vector store management endpoints or the Vector Stores page in the UI.",
			type: "boolean",
		},
		allow_vector_stores_for_team_admins: {
			description:
				"If true, team admins are exempt from the vector stores disable restriction (only takes effect when disable_vector_stores_for_internal_users is true).",
			type: "boolean",
		},
		scope_user_search_to_org: {
			description:
				"If enabled, the user search endpoint (/user/filter/ui) restricts results by organization. When off, any authenticated user can search all users.",
			type: "boolean",
		},
		disable_custom_api_keys: {
			description: "If true, users cannot specify custom key values. All keys must be auto-generated.",
			type: "boolean",
		},
	},
};

function makeUiSettingsResponse(): UiSettingsResponse {
	return {
		values: {
			disable_model_add_for_internal_users: false,
			disable_team_admin_delete_team_user: false,
			enabled_ui_pages_internal_users: null,
			require_auth_for_public_ai_hub: false,
			forward_client_headers_to_llm_api: false,
			enable_projects_ui: false,
			disable_agents_for_internal_users: false,
			allow_agents_for_team_admins: false,
			disable_vector_stores_for_internal_users: false,
			allow_vector_stores_for_team_admins: false,
			scope_user_search_to_org: false,
			disable_custom_api_keys: false,
		},
		field_schema: UI_SETTINGS_FIELD_SCHEMA,
	};
}

function makeSsoUiSettingsResponse(): SsoUiSettingsResponse {
	return {
		PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? null,
		PROXY_LOGOUT_URL: process.env.PROXY_LOGOUT_URL ?? null,
		LITELLM_UI_API_DOC_BASE_URL: process.env.LITELLM_UI_API_DOC_BASE_URL ?? null,
		DEFAULT_TEAM_DISABLED: process.env.PROXY_DEFAULT_TEAM_DISABLED?.toLowerCase() === "true",
		SSO_ENABLED: false,
		NUM_SPEND_LOGS_ROWS: 0,
		DISABLE_EXPENSIVE_DB_QUERIES: false,
	};
}

/**
 * 注册 WebUI 公开支撑端点（无鉴权）。
 *
 * 这些端点在 WebUI 启动/首页加载时即被请求，缺失或鉴权会触发 401/404。
 * @param router - publicRouter（无 authMiddleware）
 * @param costMapService
 */
export function registerWebUiSupportPublicRoutes(router: Router, costMapService: ModelCostMapService = modelCostMapService): void {
	const uiSettings = (): UiSettingsResponse => makeUiSettingsResponse();

	// ── UI 偏好（无 cookie 时也要返回默认值） ──

	/** UI 偏好设置，WebUI 启动时无 token 也需要 */
	registerRoute(router, { method: "get", path: "/get/ui_settings" }, uiSettings);

	/**
	 * UI 主题设置（logo/favicon URL）。
	 * 对齐 Python：数据源为 DB litellm_settings.ui_theme_config（LiteLLM_Config 表，
	 * WebUI Theme 设置页写入），响应含 values + field_schema。
	 */
	registerRoute(router, { method: "get", path: "/get/ui_theme_settings" }, async () => {
		const litellmSettings = await dbConfigProvider.getParam("litellm_settings");
		const themeConfig = isRecord(litellmSettings["ui_theme_config"]) ? litellmSettings["ui_theme_config"] : {};
		return {
			values: {
				logo_url: typeof themeConfig["logo_url"] === "string" ? themeConfig["logo_url"] : null,
				favicon_url: typeof themeConfig["favicon_url"] === "string" ? themeConfig["favicon_url"] : null,
			},
			field_schema: {
				description: "Configuration for UI theme customization",
				properties: {
					logo_url: {
						description: "URL or path to custom logo image. Can be a local file path or HTTP/HTTPS URL",
						type: "string",
					},
					favicon_url: {
						description: "URL to custom favicon image. Must be an HTTP/HTTPS URL to a .ico, .png, or .svg file",
						type: "string",
					},
				},
			},
		};
	});

	/** SSO UI 偏好（dashboard 启动时拉取） */
	registerRoute(router, { method: "get", path: "/sso/get/ui_settings" }, makeSsoUiSettingsResponse);

	/**
	 * get_image：返回 UI logo 图片（image/jpeg）。
	 * 对齐 Python get_image：HTTP/HTTPS logo URL 下载并缓存（内存缓存）；
	 * 无自定义 logo 或下载失败时回退内置默认 logo（src/data/logo.jpg）。
	 * logo URL 来源：UI_LOGO_PATH env > DB ui_theme_config.logo_url。
	 */
	registerRoute(router, { method: "get", path: "/get_image" }, async (_req, res) => {
		const body = await resolveLogoImage();
		res.type("image/jpeg").send(body);
	});

	// ── 公开端点：model cost map ──

	/** 模型成本映射表，WebUI 用于显示 provider 和定价信息（对齐 Python litellm.model_cost 全量，原始 JSON 透传） */
	registerRoute(router, { method: "get", path: "/public/litellm_model_cost_map" }, (_req, res) => {
		res.type("application/json").send(costMapService.getSnapshot().rawJson);
	});

	/** Provider 凭据字段元数据，WebUI 用于动态渲染 provider 特定的表单 */
	registerRoute(router, { method: "get", path: "/public/providers/fields" }, (): readonly ProviderCreateInfo[] => PROVIDER_CREATE_FIELDS);
}

/** 管理端校验执行链所需的命名 Credential 列表。 */
export interface BuiltinCapabilityCredentialLister {
	/**
	 * 返回已保存的 Credential 视图列表。
	 */
	list(): Promise<ReadonlyArray<{ readonly credential_name: string }>>;
}

/**
 * 取出管理员本次提交的模型执行者名称（保留重复与顺序）。
 *
 * 同时接受新的 \`executors\` 结构与历史的 \`handler_model\` + \`fallback_models\`，
 * 两种写法共用同一套重复校验。
 * @param submitted - 本次 PUT 提交的单个能力配置
 * @returns 提交顺序下的模型执行者名称（保留重复）
 */
function submittedExecutorModels(submitted: Record<string, unknown> | undefined): string[] {
	if (submitted === undefined) {
		return [];
	}
	const executors = submitted["executors"];
	if (Array.isArray(executors)) {
		return executors
			.map((entry) => {
				if (typeof entry !== "object" || entry === null) {
					return "";
				}
				const record = entry as Record<string, unknown>;
				if (record["type"] !== "model") {
					return "";
				}
				return String(record["model"] ?? "").trim();
			})
			.filter((model) => model.length > 0);
	}
	const handlerModel = typeof submitted["handler_model"] === "string" ? submitted["handler_model"].trim() : "";
	const fallbackModels = Array.isArray(submitted["fallback_models"])
		? (submitted["fallback_models"] as unknown[]).map((model) => String(model ?? "").trim()).filter(Boolean)
		: [];
	return [...(handlerModel.length > 0 ? [handlerModel] : []), ...fallbackModels];
}

/**
 * 校验一个内置能力的执行链。
 *
 * 三条规则与运行路径一一对应：链非空、模型名必须在 Router 里可路由、
 * 直连执行者引用的 Credential 必须已存在。这样配置错误在保存时暴露，
 * 而不是等到线上第一次联网调用才失败。
 * @param capability - 用于错误信息的能力名
 * @param settings - 归一化后的能力配置
 * @param availableModels - 当前可路由的模型名集合
 * @param credentialNames - 已保存的 Credential 名称集合；undefined 表示跳过该检查
 * @param submitted - 本次 PUT 提交的原始能力配置，用于在去重前发现重复项
 * @throws ApiError 链为空、模型不可路由、模型重复或 Credential 不存在时抛出 400
 */
function validateCapabilityExecutors(
	capability: BuiltinCapabilityId,
	settings: BuiltinCapabilitySettings,
	availableModels: ReadonlySet<string>,
	credentialNames?: ReadonlySet<string>,
	submitted?: Record<string, unknown>,
): void {
	if (settings.enabled && settings.executors.length === 0) {
		throw ApiError.badRequest(`Enabled ${capability} capability requires at least one executor`);
	}
	// 归一化会去重，因此「同一条链里重复提交同一个模型」必须在原始载荷上检查，
	// 否则管理员的重复配置会被静默吞掉而不是收到明确报错。
	const submittedModels = submittedExecutorModels(submitted);
	const duplicated = submittedModels.find((model, index) => submittedModels.indexOf(model) !== index);
	if (duplicated !== undefined) {
		throw ApiError.badRequest(`Duplicate ${capability} executor model: ${duplicated}`);
	}
	for (const executor of settings.executors) {
		if (executor.type === "model") {
			if (!availableModels.has(executor.model)) {
				throw ApiError.badRequest(`Unknown ${capability} executor model: ${executor.model}`);
			}
			continue;
		}
		if (capability !== "web") {
			throw ApiError.badRequest(`${capability} capability does not support ${executor.type} executors`);
		}
		if (credentialNames !== undefined && !credentialNames.has(executor.credential_name)) {
			throw ApiError.badRequest(`Unknown web executor credential: ${executor.credential_name}`);
		}
	}
}

/**
 * 注册 WebUI 鉴权支撑端点。
 * @param router - 已经过鉴权的 Router
 * @param config - 服务配置
 * @param db - Drizzle 数据库实例（LiteLLM_Config 写路径：/config/update、/config/field/*、/update/ui_theme_settings）
 * @param litellmRouter - 可选 LiteLLM Router；提供时 /config/update 写 router_settings 后立即热应用（批次 C1）
 * @param credentialService - 可选 Credential 服务；提供时保存内置能力前会校验直连执行者引用的凭据存在
 */
export function registerWebUiSupportRoutes(
	router: Router,
	config: ServiceConfig,
	db: DrizzleDb,
	litellmRouter?: LiteLLMRouter,
	credentialService?: BuiltinCapabilityCredentialLister,
): void {
	const configRepository = configRepositoryFor(db);

	// 注：/get/ui_settings、/get/ui_theme_settings、/sso/get/ui_settings、/get_image
	// 等无需鉴权的端点已移到 registerWebUiSupportPublicRoutes

	/**
	 * 列出某类配置的可用字段及当前值。
	 *
	 * Python LiteLLM 实现见 `litellm/proxy/proxy_server.py:12225-12371`
	 * （`get_config_list`），返回 `List[ConfigList]`，每个元素含 `field_name`、
	 * `field_type`、`field_description`、`field_value`、`stored_in_db`、
	 * `field_default_value`、`premium_field?`、`nested_fields?`（`_types.py:2096-2114`）。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 *
	 * WebUI `useProxyConfig` 直接对返回值调用 `.find`（如
	 * `n.find(e => e.field_name === "store_model_in_db")`），所以必须返回数组而不是
	 * 按顶级配置节分组的对象。ModelSettingsModal 渲染时也会读取 `field_value`、
	 * `field_default_value`、`stored_in_db` 等字段；删除字段会让对应设置项在 WebUI 不可配置。
	 */
	const generalSettingsFields: ReadonlyArray<{
		readonly field_name: string;
		readonly field_type: ConfigFieldType;
		readonly field_description: string;
		readonly field_default_value: unknown;
	}> = [
		{
			field_name: "max_parallel_requests",
			field_type: ConfigFieldType.INTEGER,
			field_description: "maximum parallel requests for each api key",
			field_default_value: null,
		},
		{
			field_name: "global_max_parallel_requests",
			field_type: ConfigFieldType.INTEGER,
			field_description: "global max parallel requests to allow for a proxy instance.",
			field_default_value: null,
		},
		{
			field_name: "max_request_size_mb",
			field_type: ConfigFieldType.INTEGER,
			field_description: "max request size in MB, if a request is larger than this size it will be rejected",
			field_default_value: null,
		},
		{
			field_name: "max_response_size_mb",
			field_type: ConfigFieldType.INTEGER,
			field_description: "max response size in MB, if a response is larger than this size it will be rejected",
			field_default_value: null,
		},
		{
			field_name: "pass_through_endpoints",
			field_type: ConfigFieldType.PYDANTIC_MODEL,
			field_description: "list of pass-through endpoints",
			field_default_value: null,
		},
		{
			field_name: "store_model_in_db",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "store model definitions in the database",
			field_default_value: null,
		},
		{
			field_name: "store_prompts_in_spend_logs",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "store prompt text in spend logs",
			field_default_value: null,
		},
		{
			field_name: "store_upstream_logs_in_spend_logs",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "store provider upstream request and response details in spend logs",
			field_default_value: null,
		},
		{
			field_name: "maximum_spend_logs_retention_period",
			field_type: ConfigFieldType.STRING,
			field_description: "retention period for spend logs (e.g. '30d')",
			field_default_value: null,
		},
		{
			field_name: "websearch_override_target_model",
			field_type: ConfigFieldType.STRING,
			field_description: "target model used for Anthropic requests with only a forced web_search tool",
			field_default_value: null,
		},
		{
			field_name: "mcp_internal_ip_ranges",
			field_type: ConfigFieldType.LIST,
			field_description: "internal IP ranges allowed to call MCP servers",
			field_default_value: null,
		},
		{
			field_name: "mcp_trusted_proxy_ranges",
			field_type: ConfigFieldType.LIST,
			field_description: "trusted proxy IP ranges for MCP",
			field_default_value: null,
		},
		{
			field_name: "always_include_stream_usage",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "always include usage in streaming responses",
			field_default_value: null,
		},
		{
			field_name: "forward_client_headers_to_llm_api",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "forward client headers to the upstream LLM API",
			field_default_value: null,
		},
		{
			field_name: "mcp_required_fields",
			field_type: ConfigFieldType.LIST,
			field_description: "required fields for MCP server configurations",
			field_default_value: null,
		},
	];

	registerRoute(router, { method: "get", path: "/config/list" }, async (req) => {
		// Python get_config_list 的 config_type 为必填 Literal["general_settings"]
		// （litellm/proxy/proxy_server.py:12231-12232）：
		// 缺省 → 422 missing；其他取值 → 422 literal_error（FastAPI 校验语义）。
		const configType = req.query.config_type as string | undefined;
		if (configType === undefined) {
			throw ApiError.unprocessableEntity([{ loc: ["query", "config_type"], msg: "Field required", type: "missing" }]);
		}
		if (configType !== "general_settings") {
			throw ApiError.unprocessableEntity([
				{ loc: ["query", "config_type"], msg: "Input should be 'general_settings'", type: "literal_error" },
			]);
		}
		const generalSettings = await getEffectiveGeneralSettings(config);
		const dbGeneralSettings = await dbConfigProvider.getParam("general_settings");
		return generalSettingsFields.map((field) => {
			const fieldValue = field.field_name in generalSettings ? (generalSettings as Record<string, unknown>)[field.field_name] : null;
			// stored_in_db：值来自 DB → true；来自 yaml → false；未配置 → null（对齐 Python get_config_list）
			const storedInDb = field.field_name in dbGeneralSettings ? true : field.field_name in generalSettings ? false : null;
			return {
				field_name: field.field_name,
				field_type: field.field_type,
				field_description: field.field_description,
				field_value: fieldValue,
				stored_in_db: storedInDb,
				field_default_value: field.field_default_value,
				premium_field: false,
				nested_fields: null,
			};
		});
	});

	const getRoutableModelCandidates = () => {
		if (!litellmRouter) {
			throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: "Router is not available" });
		}
		return { data: litellmRouter.getAvailableModelNames() };
	};

	registerRoute(router, { method: "get", path: "/config/routable_model/options" }, getRoutableModelCandidates);
	registerRoute(router, { method: "get", path: "/config/websearch_override_target_model/options" }, getRoutableModelCandidates);

	/**
	 * Built-in capability manager data. Reading is available to authenticated
	 * model editors; mutation remains proxy-admin only.
	 */
	registerRoute(router, { method: "get", path: "/builtin-capabilities" }, async () => {
		const configValue = normalizeBuiltinCapabilitiesConfig((await configRepository.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM)) ?? {});
		const availableModelOptions = litellmRouter?.getAvailableModelNames() ?? [];
		return {
			capabilities: configValue,
			available_models: availableModelOptions,
			image_generation_available_models: availableModelOptions,
			web_available_models: availableModelOptions,
		};
	});

	registerRoute(router, { method: "put", path: "/builtin-capabilities" }, async (req) => {
		assertProxyAdmin(req);
		if (!isRecord(req.body)) {
			throw ApiError.badRequest("At least one capability setting is required");
		}
		const hasVision = Object.prototype.hasOwnProperty.call(req.body, "vision");
		const hasImageGeneration = Object.prototype.hasOwnProperty.call(req.body, "image_generation");
		const hasWeb = Object.prototype.hasOwnProperty.call(req.body, "web");
		if (
			(!hasVision && !hasImageGeneration && !hasWeb) ||
			(hasVision && !isRecord(req.body["vision"])) ||
			(hasImageGeneration && !isRecord(req.body["image_generation"])) ||
			(hasWeb && !isRecord(req.body["web"]))
		) {
			throw ApiError.badRequest("vision, image_generation and web capability settings must be objects when provided");
		}
		const storedConfig = (await configRepository.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM)) ?? {};
		const currentConfig = normalizeBuiltinCapabilitiesConfig(storedConfig);
		const configValue = normalizeBuiltinCapabilitiesConfig({
			vision: hasVision ? req.body["vision"] : currentConfig.vision,
			image_generation: hasImageGeneration ? req.body["image_generation"] : currentConfig.image_generation,
			web: hasWeb ? req.body["web"] : currentConfig.web,
		});
		const vision = configValue.vision;
		const imageGeneration = configValue.image_generation;
		const web = configValue.web;
		const availableModelOptions = litellmRouter?.getAvailableModelNames() ?? [];
		const availableModels = new Set(availableModelOptions.map((candidate) => candidate.model_name));
		// 直连执行者只引用命名 Credential，保存前先确认该 Credential 存在，
		// 避免把拼错的凭据名持久化后要到第一次联网调用才失败。
		const credentialNames =
			credentialService === undefined
				? undefined
				: new Set((await credentialService.list()).map((credential) => credential.credential_name));
		if (hasVision) {
			validateCapabilityExecutors(
				"vision",
				vision,
				availableModels,
				undefined,
				isRecord(req.body["vision"]) ? req.body["vision"] : undefined,
			);
		}
		if (hasWeb) {
			validateCapabilityExecutors(
				"web",
				web,
				availableModels,
				credentialNames,
				isRecord(req.body["web"]) ? req.body["web"] : undefined,
			);
		}
		if (hasImageGeneration) {
			validateCapabilityExecutors(
				"image_generation",
				imageGeneration,
				availableModels,
				undefined,
				isRecord(req.body["image_generation"]) ? req.body["image_generation"] : undefined,
			);
		}
		// 只规范化本次提交的能力；未提交的能力原样保留。
		// 否则一次只改 vision 的保存会把管理员从未编辑过的 web 配置重写成新结构，
		// 让持久化内容与「只改了一项」的意图不符，也会让回滚变得不可判定。
		const nextStoredConfig: Record<string, unknown> = isRecord(storedConfig) ? { ...storedConfig } : {};
		const keepOrWrite = (capability: "vision" | "image_generation" | "web", submitted: boolean): void => {
			// 已提交：写入规范化结果。未提交但库里已有：原样保留。
			// 未提交且库里没有：补上规范化默认值，保证存储文档与响应结构一致。
			if (!submitted && Object.prototype.hasOwnProperty.call(nextStoredConfig, capability)) {
				return;
			}
			nextStoredConfig[capability] = configValue[capability];
		};
		keepOrWrite("vision", hasVision);
		keepOrWrite("image_generation", hasImageGeneration);
		keepOrWrite("web", hasWeb);
		await configRepository.upsertParam(BUILTIN_CAPABILITIES_CONFIG_PARAM, nextStoredConfig);
		return {
			capabilities: configValue,
			available_models: availableModelOptions,
			image_generation_available_models: availableModelOptions,
			web_available_models: availableModelOptions,
		};
	});

	/**
	 * 更新配置（对齐 Python update_config，proxy_server.py:11930）。
	 * general_settings / litellm_settings / router_settings / environment_variables
	 * 各段深合并进现有 DB 值后 upsert（合并不是整段替换）。
	 * 后续请求会直接查询数据库，不需要刷新或热写进程内 Router。
	 */
	registerRoute(router, { method: "post", path: "/config/update" }, async (req) => {
		const body = (req.body ?? {}) as ConfigUpdateRequestBody;
		// Reject invalid schedules before writing any section of the request.
		for (const section of ["general_settings", "router_settings"] as const) {
			const incoming = body[section];
			if (isRecord(incoming) && Object.prototype.hasOwnProperty.call(incoming, "model_group_alias")) {
				try {
					validateModelGroupAliases(incoming.model_group_alias);
					validateModelGroupAliases({
						...incoming.model_group_alias,
						...buildModelGroupOverrides(litellmRouter?.getDeployments?.() ?? []),
					});
				} catch (error) {
					throw ApiError.badRequest(error instanceof Error ? error.message : "Invalid model group aliases");
				}
			}
			// fallbacks 是运行期直接决定请求落到哪个模型的配置，写坏一次就可能把流量送到
			// 没有额度的模型上，因此在入库前校验条目形态（目标列表 / targets + recurse）。
			if (isRecord(incoming) && Object.prototype.hasOwnProperty.call(incoming, "fallbacks")) {
				try {
					validateFallbackEntries(incoming.fallbacks);
				} catch (error) {
					throw ApiError.badRequest(error instanceof Error ? error.message : "Invalid fallbacks");
				}
			}
		}
		for (const section of CONFIG_UPDATE_SECTIONS) {
			const incoming = body[section];
			if (incoming === undefined) {
				continue;
			}
			const existing = (await configRepository.getParam(section)) ?? {};
			const merged = deepMergeConfigValue(existing, incoming) as Record<string, unknown>;
			// model_group_alias 是完整映射，不是 patch。否则 UI 删除 alias 时，
			// 被省略的旧 key 会被递归深合并保留。
			if (
				(section === "router_settings" || section === "general_settings") &&
				Object.prototype.hasOwnProperty.call(incoming, "model_group_alias") &&
				isRecord(incoming.model_group_alias)
			) {
				merged["model_group_alias"] = structuredClone(incoming.model_group_alias);
			}
			// 引用悬空守卫：模型组与别名是配置里被引用的名字，改配置时把引用改成
			// 不存在的名字（改名只改一处）会在下一次路由时静默失效。只拦截本次更新
			// 新引入的悬空——库里既有悬空由 GET /model/references/audit 报告并另行修复。
			// 模型表为空（全新安装）时无从解析，跳过校验。
			if (section === "router_settings" || section === "general_settings") {
				const state = await loadModelReferenceState(db);
				if (isModelReferenceValidationPossible(state)) {
					const before = auditModelReferences(state);
					const after = auditModelReferences({
						...state,
						...(section === "router_settings" ? { routerSettings: merged } : {}),
						...(section === "general_settings" ? { generalSettings: merged } : {}),
					});
					const known = new Set(before.dangling.map((item) => `${item.surface}\0${item.path}\0${item.name}`));
					const introduced = after.dangling.filter((item) => !known.has(`${item.surface}\0${item.path}\0${item.name}`));
					if (introduced.length > 0) {
						const summary = introduced
							.slice(0, 5)
							.map((item) => `${item.surface}: ${item.path} -> ${item.name}`)
							.join("; ");
						throw ApiError.badRequest(
							`配置引用了不存在的模型或别名（${summary}${introduced.length > 5 ? ` 等 ${introduced.length} 处` : ""}）。` +
								"先创建模型/别名，或用 POST /model/rename 级联改名",
						);
					}
				}
			}
			await configRepository.upsertParam(section, merged);
		}
		return { message: "Config updated successfully" };
	});
	/**
	 * 更新 general_settings 单个字段（对齐 Python /config/field/update，proxy_server.py:12085）。
	 * 响应为 LiteLLM_Config 行形状 {param_name, param_value}。
	 */
	registerRoute(router, { method: "post", path: "/config/field/update" }, async (req) => {
		const body = (req.body ?? {}) as ConfigFieldRequestBody;
		const fieldName = parseConfigFieldRequest(body);
		if (!("field_value" in body)) {
			throw ApiError.unprocessableEntity([{ loc: ["body", "field_value"], msg: "Field required", type: "missing" }]);
		}
		if (fieldName === "websearch_override_target_model") {
			const candidates = litellmRouter?.getAvailableModelNames() ?? [];
			const fieldValue = body.field_value;
			if (
				typeof fieldValue !== "string" ||
				fieldValue.trim() === "" ||
				!candidates.some((candidate) => candidate.model_name === fieldValue)
			) {
				throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: "Invalid websearch override target model" });
			}
		}
		const existing = (await configRepository.getParam("general_settings")) ?? {};
		const next = { ...existing, [fieldName]: body.field_value };
		await configRepository.upsertParam("general_settings", next);
		return { param_name: "general_settings", param_value: next };
	});
	/**
	 * 删除 general_settings 单个字段（对齐 Python /config/field/delete，proxy_server.py:12375）。
	 * DB 中不存在 general_settings 参数时返回 400（对齐 Python "Field name={} not in config"）。
	 */
	registerRoute(router, { method: "post", path: "/config/field/delete" }, async (req) => {
		const body = (req.body ?? {}) as ConfigFieldRequestBody;
		const fieldName = parseConfigFieldRequest(body);
		const next = await configRepository.deleteField("general_settings", fieldName);
		if (next === null) {
			throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: `Field name=${fieldName} not in config` });
		}
		return { param_name: "general_settings", param_value: next };
	});
	/**
	 * 更新 UI 主题设置（对齐 Python update_ui_theme_settings，
	 * ui_crud_endpoints/proxy_setting_endpoints.py:821）。
	 * ui_theme_config 整体替换写入 litellm_settings。环境变量仍只作为部署时静态覆盖，
	 * 不再用数据库值修改进程环境，否则后续直接修改数据库会被旧环境值遮蔽。
	 */
	registerRoute(router, { method: "patch", path: "/update/ui_theme_settings" }, async (req) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		// exclude_none 语义：仅携带非 null 字段
		const themeData: Record<string, unknown> = {};
		for (const key of ["logo_url", "favicon_url"] as const) {
			const value = body[key];
			if (value !== undefined && value !== null) {
				themeData[key] = value;
			}
		}
		const existing = (await configRepository.getParam("litellm_settings")) ?? {};
		const next = { ...existing, ui_theme_config: themeData };
		await configRepository.upsertParam("litellm_settings", next);
		return {
			message: "UI theme settings updated successfully.",
			status: "success",
			theme_config: themeData,
		};
	});
	/**
	 * WebUI 侧栏用量指示器：已用用户数/团队数。
	 * 对齐 Python get_available_users / 前端 UsageIndicator 读取的字段；
	 * 本部署无企业许可，上限字段为 null（前端按“无上限”展示）。
	 */
	registerRoute(router, { method: "get", path: "/user/available_users" }, async () => {
		const usage = await webUiSupportRepositoryFor(db).countUsersAndTeams();
		return {
			total_users: null,
			total_users_used: usage.users,
			total_users_remaining: null,
			total_teams: null,
			total_teams_used: usage.teams,
			total_teams_remaining: null,
		};
	});
	registerRoute(router, { method: "get", path: "/user/available_roles" }, () => WEB_UI_AVAILABLE_ROLES);
	/**
	 * 许可信息（前端 UsageIndicator 读取 has_license/expiration_date/limits）。
	 * 定制：放开企业付费功能门禁，自托管全部功能对免费用户可用，因此没有许可文件。
	 */
	registerRoute(router, { method: "get", path: "/health/license" }, () => ({
		has_license: false,
		license_type: null,
		expiration_date: null,
		allowed_features: [],
		limits: { max_users: null, max_teams: null },
	}));
	// /team/list、/v2/team/list 由 createTeamRoutes（managementRouter）提供真实 DB 查询。
	// /organization/list 由 createOrganizationRoutes（managementRouter）提供真实 DB 查询。

	/**
	 * 当前生效回调清单（对齐 Python active_callbacks）。
	 * Python 各 litellm.* 列表元素为回调对象的 str()；TS 端以配置名表示。
	 */
	registerRoute(router, { method: "get", path: "/active/callbacks" }, () => buildActiveCallbacksResponse(config));
	/**
	 * 当前 WebUI 会话用户信息；登录后全局 layout 用它决定权限与菜单。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx userInfoCall
	 */
	registerRoute(router, { method: "get", path: "/v2/user/info" }, () => ({
		user_id: PROXY_ADMIN_USER_ID,
		user_email: null,
		user_alias: null,
		user_role: WebUiUserRole.PROXY_ADMIN,
		spend: 0,
		max_budget: null,
		models: [],
		budget_duration: null,
		budget_reset_at: null,
		metadata: {},
		created_at: null,
		updated_at: null,
		sso_user_id: null,
		teams: [],
	}));

	// ── Usage / Logs 页面依赖的子端点 ──

	// Summary/detail/full 复用同一批近几天原始行；缓存按鉴权范围与过滤条件隔离。
	const usageActivityRowsCache = new UsageActivityCache<readonly DailyActivityRow[]>({
		onRefreshError: (error: unknown) =>
			logger.warn("Usage Activity 行缓存刷新失败", { error: error instanceof Error ? error.message : String(error) }),
	});

	const userDailyActivity: DailyActivityRouteConfig = {
		entityField: "user_id",
		filterParam: "user_ids",
		singleFilterParam: "user_id",
	};
	const dailyActivityRoutes: ReadonlyArray<readonly [string, DailyActivityRouteConfig]> = [
		[
			"/tag/daily/activity",
			{
				entityField: "tag",
				filterParam: "tags",
			},
		],
		[
			"/team/daily/activity",
			{
				entityField: "team_id",
				filterParam: "team_ids",
				excludeFilterParam: "exclude_team_ids",
			},
		],
		[
			"/organization/daily/activity",
			{
				entityField: "organization_id",
				filterParam: "organization_ids",
			},
		],
		[
			"/customer/daily/activity",
			{
				entityField: "end_user_id",
				filterParam: "end_user_ids",
			},
		],
		[
			"/agent/daily/activity",
			{
				entityField: "agent_id",
				filterParam: "agent_ids",
			},
		],
	];

	/** 用户每日活动聚合（Usage 页面 "Daily Spend" 图表） */
	registerRoute(
		router,
		{ method: "get", path: "/user/daily/activity/aggregated" },
		buildDailyActivityHandler(db, userDailyActivity, true, usageActivityRowsCache),
	);

	/** 用户每日活动（Usage 页面 Top Virtual Keys 表格） */
	registerRoute(
		router,
		{ method: "get", path: "/user/daily/activity" },
		buildDailyActivityHandler(db, userDailyActivity, false, usageActivityRowsCache),
	);
	for (const [routePath, routeConfig] of dailyActivityRoutes) {
		registerRoute(
			router,
			{ method: "get", path: routePath },
			buildDailyActivityHandler(db, routeConfig, false, usageActivityRowsCache),
		);
		registerRoute(
			router,
			{ method: "get", path: `${routePath}/aggregated` },
			buildDailyActivityHandler(db, routeConfig, true, usageActivityRowsCache),
		);
		registerRoute(router, { method: "get", path: `${routePath}/export` }, async (req, res) => {
			const result = await buildDailyActivityHandler(db, routeConfig, true, usageActivityRowsCache)(req);
			const lines = [
				"date,spend,prompt_tokens,completion_tokens,api_requests",
				...result.results.map((row) =>
					[row.date, row.metrics.spend, row.metrics.prompt_tokens, row.metrics.completion_tokens, row.metrics.api_requests].join(
						",",
					),
				),
			];
			res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="usage.csv"');
			res.send(lines.join("\r\n"));
		});
	}
}
