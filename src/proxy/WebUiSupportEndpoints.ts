/**
 * WebUI 支撑端点
 *
 * Python LiteLLM Dashboard 会在首页并发读取一批配置、列表和静态信息。
 * 这些端点不是模型代理核心路径，但缺失会导致复制来的 WebUI 大量 401/404。
 *
 * 本文件拆分为两类：
 * - 公开端点：WebUI 启动时无 cookie 也要拉取（model cost map、provider fields、
 *   model_hub info 等），注册到 publicRouter。
 * - 鉴权端点：依赖 token / master_key 的配置/列表，注册到鉴权 router。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Router } from "express";
import { and, count, desc, eq, gte, inArray, lte, notInArray, type SQL } from "drizzle-orm";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import type { ServiceConfig } from "../core/config";
import { generateModelId } from "../core/config";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { createModuleLogger } from "../core/utils/logger";
import { YAML_DIFF_SETTING_SECTIONS, yamlConfigDiffService, type YamlDiffSection } from "../core/config/YamlConfigDiffService";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { liteLLM_DeletedVerificationToken } from "../db/schema/deleted-verification-tokens";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { ConfigRepository } from "../repositories/ConfigRepository";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE, PROXY_ADMIN_USER_ID } from "../types/webUiSession";
import providerCreateFieldsJson from "../data/provider_create_fields.json";
import { modelCostMapService, type ModelCostMapService } from "../cost/ModelCostMapService";
import {
	BUILTIN_CAPABILITIES_CONFIG_PARAM,
	normalizeBuiltinCapabilitiesConfig,
} from "../capabilities/BuiltinCapabilitiesConfig";
import { isVisionCapableHandler } from "../capabilities/VisionCapability";

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
/** TypeScript 代理自报版本号（仅文件内使用）。WebUI 把它作为 litellm_version 字面量渲染。 */
const TS_PROXY_VERSION = "0.0.1-ts";

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
			if (response.ok) {
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
 * model_list 对齐 Python save_config 行为：剔除不入 LiteLLM_Config（模型走 ProxyModelTable）。
 */
interface ConfigUpdateRequestBody {
	readonly general_settings?: Record<string, unknown>;
	readonly litellm_settings?: Record<string, unknown>;
	readonly router_settings?: Record<string, unknown>;
	readonly environment_variables?: Record<string, unknown>;
	readonly model_list?: unknown;
}

/** /config/update 支持写入 DB 的配置段（model_list 除外） */
const CONFIG_UPDATE_SECTIONS = ["general_settings", "litellm_settings", "router_settings", "environment_variables"] as const;

/** /config/yaml_diff/accept 合法的 section 取值（四设置段 + model_list） */
const YAML_DIFF_SECTION_NAMES: ReadonlySet<string> = new Set<string>([...YAML_DIFF_SETTING_SECTIONS, "model_list"]);

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
	readonly [key: string]: unknown;
}

type DailyActivityTable =
	| typeof liteLLM_DailyUserSpend
	| typeof liteLLM_DailyTagSpend
	| typeof liteLLM_DailyTeamSpend
	| typeof liteLLM_DailyOrganizationSpend
	| typeof liteLLM_DailyEndUserSpend
	| typeof liteLLM_DailyAgentSpend;

type DailyActivityEntityColumn =
	| typeof liteLLM_DailyUserSpend.user_id
	| typeof liteLLM_DailyTagSpend.tag
	| typeof liteLLM_DailyTeamSpend.team_id
	| typeof liteLLM_DailyOrganizationSpend.organization_id
	| typeof liteLLM_DailyEndUserSpend.end_user_id
	| typeof liteLLM_DailyAgentSpend.agent_id;

interface DailyActivityRouteConfig {
	readonly table: DailyActivityTable;
	readonly entityField: "user_id" | "tag" | "team_id" | "organization_id" | "end_user_id" | "agent_id";
	readonly entityColumn: DailyActivityEntityColumn;
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
	readonly metadata: {
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
	};
}

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
	entityField: DailyActivityRouteConfig["entityField"],
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

async function loadDailyActivityKeyMetadata(db: DrizzleDb, rows: readonly DailyActivityRow[]): Promise<DailyActivityKeyMetadataMap> {
	const apiKeys = [...new Set(rows.map((row) => row.api_key).filter((apiKey) => apiKey.length > 0))];
	const metadataMap = new Map<string, DailyActivityKeyMetadata>();
	if (apiKeys.length === 0) {
		return metadataMap;
	}

	const activeRows = await db
		.select({
			token: LiteLLM_VerificationToken.token,
			keyAlias: LiteLLM_VerificationToken.keyAlias,
			keyName: LiteLLM_VerificationToken.keyName,
			teamId: LiteLLM_VerificationToken.teamId,
		})
		.from(LiteLLM_VerificationToken)
		.where(inArray(LiteLLM_VerificationToken.token, apiKeys));
	for (const row of activeRows) {
		metadataMap.set(row.token, makeDailyActivityKeyMetadata(row.keyAlias, row.keyName, row.teamId));
	}

	const missingApiKeys = apiKeys.filter((apiKey) => !metadataMap.has(apiKey));
	if (missingApiKeys.length === 0) {
		return metadataMap;
	}
	try {
		const deletedRows = await db
			.select({
				token: liteLLM_DeletedVerificationToken.token,
				keyAlias: liteLLM_DeletedVerificationToken.keyAlias,
				keyName: liteLLM_DeletedVerificationToken.keyName,
				teamId: liteLLM_DeletedVerificationToken.teamId,
				deletedAt: liteLLM_DeletedVerificationToken.deletedAt,
			})
			.from(liteLLM_DeletedVerificationToken)
			.where(inArray(liteLLM_DeletedVerificationToken.token, missingApiKeys))
			.orderBy(desc(liteLLM_DeletedVerificationToken.deletedAt));
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

function aggregateDailyActivityRows(
	rows: readonly DailyActivityRow[],
	entityField: DailyActivityRouteConfig["entityField"],
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

function buildDailyActivityHandler(db: DrizzleDb, config: DailyActivityRouteConfig, aggregated = false) {
	return async (req: { readonly query: Record<string, unknown> }): Promise<DailyActivityResponse> => {
		const startDate = typeof req.query["start_date"] === "string" ? req.query["start_date"] : null;
		const endDate = typeof req.query["end_date"] === "string" ? req.query["end_date"] : null;
		if (!startDate || !endDate) {
			throw ApiError.httpException(HTTP_STATUS.BAD_REQUEST, { error: "Please provide start_date and end_date" });
		}

		const page = aggregated ? DAILY_ACTIVITY_DEFAULT_PAGE : parseDailyActivityPage(req.query["page"], DAILY_ACTIVITY_DEFAULT_PAGE);
		const pageSize = parseDailyActivityPage(req.query["page_size"], 50);
		const conditions: SQL[] = [gte(config.table.date, startDate), lte(config.table.date, endDate)];
		const entityIds = parseDailyActivityList(req.query[config.filterParam]);
		const singleEntityId = config.singleFilterParam ? req.query[config.singleFilterParam] : undefined;
		if (entityIds.length > 0) {
			conditions.push(inArray(config.entityColumn, entityIds));
		} else if (typeof singleEntityId === "string" && singleEntityId.length > 0) {
			conditions.push(eq(config.entityColumn, singleEntityId));
		}
		if (config.excludeFilterParam) {
			const excludedIds = parseDailyActivityList(req.query[config.excludeFilterParam]);
			if (excludedIds.length > 0) {
				conditions.push(notInArray(config.entityColumn, excludedIds));
			}
		}
		if (typeof req.query["model"] === "string" && req.query["model"].length > 0) {
			conditions.push(eq(config.table.model, req.query["model"]));
		}
		const apiKeys = parseDailyActivityList(req.query["api_key"]);
		if (apiKeys.length > 0) {
			conditions.push(inArray(config.table.api_key, apiKeys));
		}

		const where = and(...conditions);
		const countRows = await db.select({ count: count() }).from(config.table).where(where);
		const totalCount = Number(countRows[0]?.count ?? 0);
		const baseQuery = db.select().from(config.table).where(where).orderBy(desc(config.table.date));
		const selectedRows = aggregated ? await baseQuery : await baseQuery.limit(pageSize).offset((page - 1) * pageSize);
		const rows = selectedRows as unknown as DailyActivityRow[];
		const keyMetadataMap = await loadDailyActivityKeyMetadata(db, rows);
		const results = aggregateDailyActivityRows(rows, config.entityField, keyMetadataMap);
		const totals = makeDailyActivityMetrics();
		for (const row of rows) {
			addDailyActivityMetrics(totals, row);
		}
		const totalPages = aggregated
			? DAILY_ACTIVITY_TOTAL_PAGES_EMPTY
			: Math.max(DAILY_ACTIVITY_TOTAL_PAGES_EMPTY, Math.ceil(totalCount / pageSize));

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
				has_more: aggregated ? false : page * pageSize < totalCount,
				page: page,
			},
		};
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
 * Agent 类型字段元数据：WebUI 用它渲染 Agent Hub 创建表单。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx AgentCreateInfo
 */
interface AgentCredentialFieldMetadata {
	readonly key: string;
	readonly label: string;
	readonly placeholder?: string | null;
	readonly tooltip?: string | null;
	readonly required?: boolean;
	readonly field_type?: CredentialFieldType;
	readonly options?: string[] | null;
	readonly default_value?: string | null;
	readonly include_in_litellm_params?: boolean;
}

/**
 * Agent 创建表单描述，返回给 WebUI agent 字段发现接口。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx AgentCreateInfo
 */
interface AgentCreateInfo {
	readonly agent_type: string;
	readonly agent_type_display_name: string;
	readonly description?: string | null;
	readonly logo_url?: string | null;
	readonly credential_fields: AgentCredentialFieldMetadata[];
	readonly litellm_params_template?: Record<string, string> | null;
	readonly model_template?: string | null;
	readonly use_a2a_form_fields?: boolean;
}

/**
 * Provider 凭据字段清单（与 Python `litellm/proxy/public_endpoints/provider_create_fields.json`
 * 同数据，109 个 provider），经 /public/providers/fields 返回。
 * JSON 中 field_type 为字符串字面量，与 CredentialFieldType 值一致，此处断言为枚举类型。
 */
const PROVIDER_CREATE_FIELDS: readonly ProviderCreateInfo[] = [
	...(providerCreateFieldsJson as unknown as ProviderCreateInfo[]),
	{
		provider: "CLIProxy",
		provider_display_name: "CLIProxy API (Managed)",
		litellm_provider: "cliproxy",
		default_model_placeholder: "Select a model discovered from the managed CLIProxy runtime",
		credential_fields: [],
	},
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

/**
 * /budget/settings 返回的可配置预算字段清单
 * （对齐 Python budget_settings：allowed_args 过滤 BudgetNewRequest.model_fields，
 * litellm/proxy/management_endpoints/budget_management_endpoints.py:252-278；
 * 字段顺序与描述以 Python 实测响应为准）。
 * TS 端预算表无数据（/budget/list 恒为空），field_value 恒为 null ——
 * 与 Python 查询不存在 budget_id 时的响应一致。
 */
const BUDGET_SETTINGS_FIELDS: ReadonlyArray<{
	readonly field_name: string;
	readonly field_type: string;
	readonly field_description: string;
}> = [
	{
		field_name: "max_budget",
		field_type: "Float",
		field_description: "Requests will fail if this budget (in USD) is exceeded.",
	},
	{
		field_name: "soft_budget",
		field_type: "Float",
		field_description: "Requests will NOT fail if this is exceeded. Will fire alerting though.",
	},
	{
		field_name: "max_parallel_requests",
		field_type: "Integer",
		field_description: "Max concurrent requests allowed for this budget id.",
	},
	{
		field_name: "tpm_limit",
		field_type: "Integer",
		field_description: "Max tokens per minute, allowed for this budget id.",
	},
	{
		field_name: "rpm_limit",
		field_type: "Integer",
		field_description: "Max requests per minute, allowed for this budget id.",
	},
	{
		field_name: "budget_duration",
		field_type: "String",
		field_description: "Max duration budget should be set for (e.g. '1hr', '1d', '28d')",
	},
	{
		field_name: "model_max_budget",
		field_type: "Object",
		field_description:
			"Max budget for each model (e.g. {'gpt-4o': {'max_budget': '0.0000001', 'budget_duration': '1d', 'tpm_limit': 1000, 'rpm_limit': 1000}})",
	},
];

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

	/** 公开博客文章列表（无鉴权） */
	registerRoute(router, { method: "get", path: "/public/litellm_blog_posts" }, () => ({ posts: [] }));

	/** 公开模型中心（WebUI AI Hub "Model Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/model_hub" }, () => []);

	/** 公开 Agent 中心（WebUI AI Hub "Agent Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/agent_hub" }, () => []);

	/** 公开 MCP 中心（WebUI AI Hub "MCP Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/mcp_hub" }, () => []);

	/** Claude Code 插件市场（WebUI AI Hub "Claude Code Plugin Marketplace" tab） */
	registerRoute(router, { method: "get", path: "/claude-code/marketplace.json" }, () => ({ plugins: [] }));

	/** Provider 凭据字段元数据，WebUI 用于动态渲染 provider 特定的表单 */
	registerRoute(router, { method: "get", path: "/public/providers/fields" }, (): readonly ProviderCreateInfo[] => PROVIDER_CREATE_FIELDS);

	/** Agent 类型字段元数据，WebUI 用于动态渲染 agent 特定的表单 */
	registerRoute(router, { method: "get", path: "/public/agents/fields" }, (): AgentCreateInfo[] => []);

	/**
	 * 公开模型中心信息。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx modelHubInfoCall
	 */
	registerRoute(router, { method: "get", path: "/public/model_hub/info" }, () => ({
		docs_title: "LiteLLM Proxy",
		custom_docs_description: null,
		litellm_version: TS_PROXY_VERSION,
		useful_links: {},
	}));
}

/**
 * 注册 WebUI 鉴权支撑端点。
 * @param router - 已经过鉴权的 Router
 * @param config - 服务配置
 * @param db - Drizzle 数据库实例（LiteLLM_Config 写路径：/config/update、/config/field/*、/update/ui_theme_settings）
 * @param litellmRouter - 可选 LiteLLM Router；提供时 /config/update 写 router_settings 后立即热应用（批次 C1）
 */
export function registerWebUiSupportRoutes(router: Router, config: ServiceConfig, db: DrizzleDb, litellmRouter?: LiteLLMRouter): void {
	const emptyList = (): unknown[] => [];
	const configRepository = new ConfigRepository(db);

	// 注：/get/ui_settings、/get/ui_theme_settings、/sso/get/ui_settings、/get_image、
	// /public/litellm_blog_posts 等无需鉴权的端点已移到 registerWebUiSupportPublicRoutes

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
		const configValue = normalizeBuiltinCapabilitiesConfig(
			(await configRepository.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM)) ?? {},
		);
		return {
			capabilities: configValue,
			available_models:
				litellmRouter
					?.getAvailableModelNames()
					.filter((candidate) => isVisionCapableHandler(litellmRouter, candidate.model_name)) ?? [],
		};
	});

	registerRoute(router, { method: "put", path: "/builtin-capabilities" }, async (req) => {
		assertProxyAdmin(req);
		if (!isRecord(req.body) || !isRecord(req.body["vision"])) {
			throw ApiError.badRequest("vision capability settings are required");
		}
		const configValue = normalizeBuiltinCapabilitiesConfig(req.body);
		const vision = configValue.vision;
		const availableModelOptions =
			litellmRouter
				?.getAvailableModelNames()
				.filter((candidate) => isVisionCapableHandler(litellmRouter, candidate.model_name)) ?? [];
		const availableModels = new Set(availableModelOptions.map((candidate) => candidate.model_name));
		if (vision.enabled && vision.handler_model.length === 0) {
			throw ApiError.badRequest("Enabled vision capability requires handler_model");
		}
		if (vision.handler_model && !availableModels.has(vision.handler_model)) {
			throw ApiError.badRequest(`Unknown vision handler model: ${vision.handler_model}`);
		}
		if (vision.fallback_models.includes(vision.handler_model)) {
			throw ApiError.badRequest("Vision fallback models must not repeat handler_model");
		}
		const unknownFallback = vision.fallback_models.find((model) => !availableModels.has(model));
		if (unknownFallback) {
			throw ApiError.badRequest(`Unknown vision fallback model: ${unknownFallback}`);
		}
		await configRepository.upsertParam(BUILTIN_CAPABILITIES_CONFIG_PARAM, configValue);
		return {
			capabilities: configValue,
			available_models: availableModelOptions,
		};
	});

	/**
	 * 更新配置（对齐 Python update_config，proxy_server.py:11930）。
	 * general_settings / litellm_settings / router_settings / environment_variables
	 * 各段深合并进现有 DB 值后 upsert（合并不是整段替换）；model_list 剔除不入库
	 * （对齐 Python save_config，模型走 ProxyModelTable）。
	 * 后续请求会直接查询数据库，不需要刷新或热写进程内 Router。
	 */
	registerRoute(router, { method: "post", path: "/config/update" }, async (req) => {
		const body = (req.body ?? {}) as ConfigUpdateRequestBody;
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
				section === "router_settings" &&
				Object.prototype.hasOwnProperty.call(incoming, "model_group_alias") &&
				isRecord(incoming.model_group_alias)
			) {
				merged["model_group_alias"] = structuredClone(incoming.model_group_alias);
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
	registerRoute(router, { method: "get", path: "/callbacks/configs" }, emptyList);
	registerRoute(router, { method: "get", path: "/user/available_users" }, () => ({ users: [] }));
	registerRoute(router, { method: "get", path: "/user/available_roles" }, () => WEB_UI_AVAILABLE_ROLES);
	// 定制：放开企业付费功能门禁，自托管全部功能对免费用户可用
	registerRoute(router, { method: "get", path: "/health/license" }, () => ({ premium_user: true, expires: null }));
	// /team/list、/v2/team/list 由 createTeamRoutes（managementRouter）提供真实 DB 查询。
	// /organization/list 由 createOrganizationRoutes（managementRouter）提供真实 DB 查询。
	registerRoute(router, { method: "get", path: "/project/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/tag/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/access_groups/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/v1/access_group" }, emptyList);
	registerRoute(router, { method: "get", path: "/in_product_nudges" }, emptyList);
	/** 预算列表（WebUI Budgets 页面 — 直接返回数组） */
	registerRoute(router, { method: "get", path: "/budget/list" }, emptyList);

	/**
	 * 预算配置字段清单（WebUI Budgets 页面字段渲染）。
	 * 对齐 Python budget_settings：缺 budget_id → 422 FastAPI 风格
	 * { detail: [{ loc, msg, type }] }；返回 ConfigList 数组。
	 */
	registerRoute(router, { method: "get", path: "/budget/settings" }, (req) => {
		const budgetId = req.query.budget_id as string | undefined;
		if (budgetId === undefined) {
			throw ApiError.unprocessableEntity([{ loc: ["query", "budget_id"], msg: "Field required", type: "missing" }]);
		}
		return BUDGET_SETTINGS_FIELDS.map((field) => ({
			field_name: field.field_name,
			field_type: field.field_type,
			field_description: field.field_description,
			field_value: null,
			stored_in_db: true,
			field_default_value: null,
			premium_field: false,
			nested_fields: null,
		}));
	});

	/**
	 * 当前生效回调清单（对齐 Python active_callbacks）。
	 * Python 各 litellm.* 列表元素为回调对象的 str()；TS 端以配置名表示。
	 */
	registerRoute(router, { method: "get", path: "/active/callbacks" }, () => buildActiveCallbacksResponse(config));
	registerRoute(router, { method: "get", path: "/guardrails/list" }, () => ({ guardrails: [] }));
	registerRoute(router, { method: "get", path: "/v2/guardrails/list" }, () => ({ guardrails: [] }));
	registerRoute(router, { method: "get", path: "/policies/list" }, () => ({ policies: [] }));
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
	registerRoute(router, { method: "get", path: "/v1/agents" }, () => []);
	registerRoute(router, { method: "get", path: "/prompts/list" }, () => ({ prompts: [], data: [] }));

	// ── Playground 页面依赖的列表端点 ──

	/** 列出 Vector Stores，WebUI Playground 选择器使用 */
	registerRoute(router, { method: "get", path: "/vector_store/list" }, () => []);

	/** 列出 MCP Servers（WebUI Playground MCP 列表） */
	registerRoute(router, { method: "get", path: "/v1/mcp/server" }, () => []);

	// ── 用户设置端点 ──

	/** 内部用户设置（UI 偏好等） */
	registerRoute(router, { method: "get", path: "/get/internal_user_settings" }, () => ({
		settings: {},
	}));

	/** 更新内部用户设置 */
	registerRoute(router, { method: "patch", path: "/update/internal_user_settings" }, () => ({
		success: true,
	}));

	// ── Guardrails 页面依赖的子端点 ──

	/** Guardrails UI 添加表单设置（Presidio / Bedrock / OpenAI 等 provider 通用选项） */
	registerRoute(router, { method: "get", path: "/guardrails/ui/add_guardrail_settings" }, () => ({}));

	/** Guardrail provider 特定参数（不同 provider 表单字段元数据） */
	registerRoute(router, { method: "get", path: "/guardrails/ui/provider_specific_params" }, () => ({}));

	/**
	 * 用户提交的 Guardrails（WebUI Guardrails 页面 "Submitted Guardrails" tab）。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
	 */
	registerRoute(router, { method: "get", path: "/guardrails/submissions" }, () => ({
		items: [],
		total: 0,
		pending_review: 0,
		active: 0,
		rejected: 0,
	}));

	/**
	 * Guardrails Monitor 概览（按时间范围聚合评估次数、阻止数、通过率等）。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
	 */
	registerRoute(router, { method: "get", path: "/guardrails/usage/overview" }, () => ({
		total_evaluations: 0,
		blocked_requests: 0,
		passed_requests: 0,
		pass_rate: 0,
		avg_latency_ms: 0,
		active_guardrails: 0,
		timeseries: [],
		guardrails: [],
	}));

	// ── Policies 页面依赖的子端点 ──

	/** 策略模板（WebUI Policies 页面 "Templates" tab，期望纯数组） */
	registerRoute(router, { method: "get", path: "/policy/templates" }, emptyList);

	/** 策略附件列表（WebUI Policies 页面 "Attachments" tab，期望纯数组） */
	registerRoute(router, { method: "get", path: "/policies/attachments/list" }, emptyList);

	// ── Usage / Logs 页面依赖的子端点 ──

	const userDailyActivity: DailyActivityRouteConfig = {
		table: liteLLM_DailyUserSpend,
		entityField: "user_id",
		entityColumn: liteLLM_DailyUserSpend.user_id,
		filterParam: "user_ids",
		singleFilterParam: "user_id",
	};
	const dailyActivityRoutes: ReadonlyArray<readonly [string, DailyActivityRouteConfig]> = [
		[
			"/tag/daily/activity",
			{
				table: liteLLM_DailyTagSpend,
				entityField: "tag",
				entityColumn: liteLLM_DailyTagSpend.tag,
				filterParam: "tags",
			},
		],
		[
			"/team/daily/activity",
			{
				table: liteLLM_DailyTeamSpend,
				entityField: "team_id",
				entityColumn: liteLLM_DailyTeamSpend.team_id,
				filterParam: "team_ids",
				excludeFilterParam: "exclude_team_ids",
			},
		],
		[
			"/organization/daily/activity",
			{
				table: liteLLM_DailyOrganizationSpend,
				entityField: "organization_id",
				entityColumn: liteLLM_DailyOrganizationSpend.organization_id,
				filterParam: "organization_ids",
			},
		],
		[
			"/customer/daily/activity",
			{
				table: liteLLM_DailyEndUserSpend,
				entityField: "end_user_id",
				entityColumn: liteLLM_DailyEndUserSpend.end_user_id,
				filterParam: "end_user_ids",
			},
		],
		[
			"/agent/daily/activity",
			{
				table: liteLLM_DailyAgentSpend,
				entityField: "agent_id",
				entityColumn: liteLLM_DailyAgentSpend.agent_id,
				filterParam: "agent_ids",
			},
		],
	];

	/** 用户每日活动聚合（Usage 页面 "Daily Spend" 图表） */
	registerRoute(
		router,
		{ method: "get", path: "/user/daily/activity/aggregated" },
		buildDailyActivityHandler(db, userDailyActivity, true),
	);

	/** 用户每日活动（Usage 页面 Top Virtual Keys 表格） */
	registerRoute(router, { method: "get", path: "/user/daily/activity" }, buildDailyActivityHandler(db, userDailyActivity));
	for (const [routePath, routeConfig] of dailyActivityRoutes) {
		registerRoute(router, { method: "get", path: routePath }, buildDailyActivityHandler(db, routeConfig));
	}

	/** 客户列表（Customer-based usage tab） */
	registerRoute(router, { method: "get", path: "/customer/list" }, () => []);

	// ── yaml 差异对比导入窗口（批次 E3，仅 proxy_admin） ──

	/**
	 * 查询启动时检测到的 yaml ↔ DB 配置差异（pending 列表）。
	 * 响应 { has_pending, items: [{section, key, yaml_value, db_value, diff_kind}] }。
	 */
	registerRoute(router, { method: "get", path: "/config/yaml_diff" }, (req) => {
		assertProxyAdmin(req);
		return { has_pending: yamlConfigDiffService.hasPending(), items: yamlConfigDiffService.getPendingItems() };
	});

	/**
	 * 接受某项 yaml 差异（yaml 值覆盖 DB）：
	 * - 设置段：yaml 值深合并进 DB 对应 param 并 upsert；
	 * - model_list：该模型 upsert 进 LiteLLM_ProxyModelTable；
	 *   DB 已有同名模型沿用其 model_id，否则按 yaml litellm_params 生成
	 *   （与启动时 yaml deployment 的 id 一致，upsert 后运行时无变化）。
	 * 接受后从 pending 列表移除该项。
	 */
	registerRoute(router, { method: "post", path: "/config/yaml_diff/accept" }, async (req) => {
		assertProxyAdmin(req);
		const body = (req.body ?? {}) as Record<string, unknown>;
		const section = body["section"];
		const key = body["key"];
		if (typeof section !== "string" || section.length === 0) {
			throw ApiError.unprocessableEntity([{ loc: ["body", "section"], msg: "Field required", type: "missing" }]);
		}
		if (typeof key !== "string" || key.length === 0) {
			throw ApiError.unprocessableEntity([{ loc: ["body", "key"], msg: "Field required", type: "missing" }]);
		}
		if (!YAML_DIFF_SECTION_NAMES.has(section)) {
			throw ApiError.badRequest(`Invalid section=${section} passed in.`);
		}
		const item = yamlConfigDiffService.findPendingItem(section as YamlDiffSection, key);
		if (item === null) {
			throw new ApiError(HTTP_STATUS.NOT_FOUND, `yaml diff item not found: section=${section} key=${key}`);
		}

		if (section === "model_list") {
			const yamlModel = isRecord(item.yaml_value) ? item.yaml_value : {};
			const litellmParams = isRecord(yamlModel["litellm_params"]) ? yamlModel["litellm_params"] : {};
			const yamlModelInfo = isRecord(yamlModel["model_info"]) ? yamlModel["model_info"] : {};
			const dbValue = isRecord(item.db_value) ? item.db_value : null;
			const existingModelId = typeof dbValue?.["model_id"] === "string" ? dbValue["model_id"] : null;
			const modelId = existingModelId ?? generateModelId(key, litellmParams);
			const modelInfo = { ...yamlModelInfo, id: modelId, db_model: false };
			const updatedBy = req.auth?.user_id ?? PROXY_ADMIN_USER_ID;
			await db
				.insert(LiteLLM_ProxyModelTable)
				.values({
					model_id: modelId,
					model_name: key,
					litellm_params: litellmParams,
					model_info: modelInfo,
					created_by: updatedBy,
					updated_by: updatedBy,
				})
				.onConflictDoUpdate({
					target: LiteLLM_ProxyModelTable.model_id,
					set: {
						model_name: key,
						litellm_params: litellmParams,
						model_info: modelInfo,
						updated_by: updatedBy,
						updated_at: new Date(),
					},
				});
		} else {
			const existing = (await configRepository.getParam(section)) ?? {};
			const next = { ...existing, [key]: deepMergeConfigValue(existing[key], item.yaml_value) };
			await configRepository.upsertParam(section, next);
		}

		yamlConfigDiffService.removePendingItem(section as YamlDiffSection, key);
		return { status: "success", remaining_items: yamlConfigDiffService.getPendingItems().length };
	});

	/**
	 * 「处理冲突完成」：将当前 yaml 快照 {hash, content, updated_at} upsert 到
	 * config_yaml_snapshot 并清空 pending。之后重启不再触发差异检测。
	 */
	registerRoute(router, { method: "post", path: "/config/yaml_diff/resolve" }, async (req) => {
		assertProxyAdmin(req);
		const snapshot = await yamlConfigDiffService.resolveSnapshot(db);
		if (snapshot === null) {
			throw ApiError.badRequest("No yaml config loaded");
		}
		return { status: "success", snapshot: snapshot };
	});
}
