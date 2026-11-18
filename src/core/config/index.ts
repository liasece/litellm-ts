import { validateKeyAliasSettings } from "../../management/KeyAliasPolicy";
import { validateSpendMetadataFields } from "../../spend/SpendMetadataFields";
import { createModuleLogger } from "../utils/logger";
/**
 * 服务配置管理模块
 * 从 YAML 文件读取进程级启动配置，通过 zod schema 校验并提供类型安全的配置访问。
 *
 * YAML 只承载「进程如何启动与连接」的基线配置：
 * ```yaml
 * server:
 *   port: 4000
 *   host: "0.0.0.0"
 * database:
 *   host: "localhost"
 *   port: 5432
 *   database: "litellm"
 *   user: "litellm"
 *   password: "litellm"
 * litellm_settings:
 *   skip_provider_token_counting: true
 * router_settings:
 *   routing_strategy: simple-shuffle
 *   allowed_fails: 0
 *   cooldown_time: 300
 * general_settings:
 *   master_key: sk-...
 *   store_model_in_db: true
 *   database_url: postgresql://user:pass@host:port/db
 *   port: 4000
 *   host: 0.0.0.0
 * ```
 *
 * 模型部署、模型组 Alias 与 fallback 只从数据库读取，由 Dashboard 或管理接口维护；
 * YAML 中出现 `model_list`、`router_settings.fallbacks` / `model_group_alias` 等键时
 * 会被忽略并告警，避免两份配置互相覆盖。
 *
 * Python snake_case (`general_settings` / `router_settings` / `litellm_settings`)
 * 作为一等配置格式，camelCase 字段仅作为兼容回退。
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { z } from "zod";

const logger = createModuleLogger("Config");

/** `model_list` 与 `router_settings`/`general_settings` 中不再从 YAML 读取的键。 */
const UNSUPPORTED_YAML_SECTION_KEYS: Readonly<Record<string, readonly string[]>> = {
	general_settings: ["model_group_alias"],
	generalSettings: ["model_group_alias"],
	router_settings: ["fallbacks", "model_group_alias", "max_fallbacks"],
	routerSettings: ["fallbacks", "model_group_alias", "max_fallbacks"],
};

/** 模型部署只存数据库；YAML 顶层的 `model_list` 不再解析。 */
const UNSUPPORTED_YAML_TOP_LEVEL_KEYS: readonly string[] = ["model_list"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 该设置键是否已不再从 YAML 读取（模型 / Alias / fallback）。
 * 供启动校验与 yaml↔DB 差异检测共用，避免差异窗口把这些键重新导回数据库。
 * @param section - `general_settings` 或 `router_settings`（snake_case / camelCase）
 * @param key - 段内字段名
 */
export function isUnsupportedYamlSetting(section: string, key: string): boolean {
	return (UNSUPPORTED_YAML_SECTION_KEYS[section] ?? []).includes(key);
}

/**
 * 列出 YAML 中出现的、已不再支持的配置键，用于启动日志。
 * @param raw - js-yaml 原始解析对象
 */
function findUnsupportedYamlKeys(raw: unknown): string[] {
	if (!isRecord(raw)) {
		return [];
	}
	const found: string[] = [];
	for (const key of UNSUPPORTED_YAML_TOP_LEVEL_KEYS) {
		if (key in raw) {
			found.push(key);
		}
	}
	for (const [section, keys] of Object.entries(UNSUPPORTED_YAML_SECTION_KEYS)) {
		const value = raw[section];
		if (!isRecord(value)) {
			continue;
		}
		for (const key of keys) {
			if (key in value) {
				found.push(`${section}.${key}`);
			}
		}
	}
	return found;
}

/**
 * 复制设置段并移除不再支持的键，确保下游（DB 默认值、设置页）看不到它们。
 * @param settings - zod 解析后的设置段
 * @param section - 段名，用于查询忽略列表
 */
function withoutUnsupportedSettings(settings: Record<string, unknown> | undefined, section: string): Record<string, unknown> {
	const result: Record<string, unknown> = { ...(settings ?? {}) };
	for (const key of UNSUPPORTED_YAML_SECTION_KEYS[section] ?? []) {
		delete result[key];
	}
	return result;
}

// ============ Zod Schema 定义 ============

const ServerSchema = z.object({
	port: z.number().default(4000),
	host: z.string().default("0.0.0.0"),
});

const LoggingSchema = z.object({
	level: z.string().default("info"),
});

const DatabaseSchema = z.object({
	host: z.string().default("localhost"),
	port: z.number().default(5432),
	database: z.string().default("litellm"),
	user: z.string().default("litellm"),
	password: z.string().default("litellm"),
});

const LiteLLMSettingsSchema = z.object({
	/** 默认模型（如 "gpt-4o"） */
	defaultModel: z.string().default("gpt-4o"),
	/** 默认最大重试次数 */
	maxRetries: z.number().default(3),
	/** 请求超时时间（毫秒） */
	requestTimeoutMs: z.number().default(60000),
});

/** Router settings schema (litellm YAML style) */
const RouterSettingsSchema = z.object({
	/** 路由策略：cost-based / latency-based / round-robin */
	strategy: z.enum(["cost-based", "latency-based", "round-robin"]).default("latency-based"),
	/** 健康检查间隔（秒） */
	healthCheckIntervalSec: z.number().default(30),
	/** 连续失败多少次后标记为不健康 */
	maxConsecutiveFailures: z.number().default(5),

	// Litellm proxy router fields (snake_case, optional)
	allowed_fails: z.number().optional(),
	cooldown_time: z.number().optional(),
	num_retries: z.number().optional(),
	routing_strategy: z.string().optional(),
	enable_pre_call_checks: z.boolean().optional(),
	search_tools: z.array(z.record(z.unknown())).optional(),
	redis_url: z.string().optional(),
	request_timeout: z.number().optional(),
});

/** General settings schema (litellm YAML style) */
const GeneralSettingsSchema = z.object({
	/** 部署环境 */
	environment: z.enum(["development", "staging", "production"]).default("development"),
	/** 是否启用详细错误信息返回给客户端 */
	verboseErrors: z.boolean().default(true),
	/** 临时文件目录 */
	tempDir: z.string().default("/tmp/litellm"),

	// Litellm proxy general fields (snake_case, optional)
	master_key: z.string().optional(),
	store_model_in_db: z.boolean().optional(),
	websearch_override_target_model: z.string().optional(),
	skip_provider_token_counting: z.boolean().optional(),
	database_url: z.string().optional(),
	database_connection_pool_limit: z.number().optional(),
	proxy_logging_retry_min_delay: z.number().optional(),
	max_log_files: z.number().optional(),
	/**
	 * GAP: PY `disable_adding_master_key_hash_to_db` — 控制是否将 master key 明文/哈希
	 * 写入 LiteLLM_SpendLogs.api_key 列。默认 false 即写入哈希；true 时跳过 master key 写入
	 * 避免任何持久化（既无明文也无哈希）。
	 */
	disable_adding_master_key_hash_to_db: z.boolean().optional(),
	store_prompts_in_spend_logs: z.boolean().optional(),
	/** 是否在 SpendLogs 中存储 Provider 实际请求/响应详情，默认关闭 */
	store_upstream_logs_in_spend_logs: z.boolean().optional(),
	/**
	 * 是否把 SpendLogs 的消息内容改写为内容寻址块引用，默认开启。
	 * 关闭后回落到把完整消息数组直接写进 jsonb 列（优化前的行为）。
	 */
	spend_log_block_dedup: z.boolean().optional(),
});

/**
 * 顶层配置 schema
 *
 * snake_case 顶层字段（litellm_settings / router_settings / general_settings）是主输入；
 * camelCase 顶层字段（server / database / generalSettings / routerSettings / litellmSettings）
 * 作为兼容回退，运行时通过 validateAndTransform 派生。
 * 模型部署不在此 schema 中：它们只存在数据库，由 Dashboard 与管理接口维护。
 */
const RawServiceConfigSchema = z
	.object({
		// TS 兼容回退字段（camelCase）
		server: ServerSchema.default({}),
		logging: LoggingSchema.default({}),
		database: DatabaseSchema.default({}),
		litellmSettings: LiteLLMSettingsSchema.default({}),
		routerSettings: RouterSettingsSchema.default({}),
		generalSettings: GeneralSettingsSchema.default({}),

		// Python LiteLLM 顶层 snake_case 字段 — 一等配置格式
		litellm_settings: z.record(z.unknown()).optional(),
		router_settings: z.record(z.unknown()).optional(),
		general_settings: z.record(z.unknown()).optional(),
	})
	.passthrough();

// ============ Interface 类型定义 ============

/** 服务器配置 */
export interface ServerConfig {
	/** 监听端口 */
	readonly port: number;
	/** 监听地址 */
	readonly host: string;
}

/** 日志配置 */
export interface LoggingConfig {
	/** 日志级别 */
	readonly level: string;
}

/** PostgreSQL 数据库连接配置 */
export interface DatabaseConfig {
	/** 数据库主机 */
	readonly host: string;
	/** 数据库端口 */
	readonly port: number;
	/** 数据库名称 */
	readonly database: string;
	/** 数据库用户名；连接串来源时保留 URL 编码形式，仅用于兼容配置展示。 */
	readonly user: string;
	/** 数据库密码；连接串来源时保留 URL 编码形式，仅用于兼容配置展示。 */
	readonly password: string;
	/** 原始 PostgreSQL 连接串，保留 SSL、options、schema 与编码凭据语义。 */
	readonly connectionString?: string;
	/** pg.Pool 最大连接数。 */
	readonly maxConnections?: number;
}

/** LiteLLM 核心设置 */
export interface LiteLLMSettings {
	/** 默认模型 */
	readonly defaultModel: string;
	/** 默认最大重试次数 */
	readonly maxRetries: number;
	/** 请求超时时间（毫秒） */
	readonly requestTimeoutMs: number;
}

/** 路由设置 */
export interface RouterSettings {
	/** 路由策略 */
	readonly strategy: "cost-based" | "latency-based" | "round-robin";
	/** 健康检查间隔（秒） */
	readonly healthCheckIntervalSec: number;
	/** 连续失败多少次后标记为不健康 */
	readonly maxConsecutiveFailures: number;
	// Litellm proxy fields
	/** 最大允许的失败数后进入冷却 */
	readonly allowed_fails?: number;
	/** 冷却时间（秒） */
	readonly cooldown_time?: number;
	/** 失败重试次数 */
	readonly num_retries?: number;
	/** 路由策略名称 */
	readonly routing_strategy?: string;
	/** 启用请求前预检 */
	readonly enable_pre_call_checks?: boolean;
	/** 搜索工具配置（websearch 拦截与 /v1/search/tools 清单） */
	readonly search_tools?: Record<string, unknown>[];
	/** Redis 连接 URL */
	readonly redis_url?: string;
	/** 请求超时时间（秒） */
	readonly request_timeout?: number;
}

/** 通用设置 */
export interface GeneralSettings {
	/** 部署环境 */
	readonly environment: "development" | "staging" | "production";
	/** 是否启用详细错误信息返回给客户端 */
	readonly verboseErrors: boolean;
	/** 临时文件目录 */
	readonly tempDir: string;
	// Litellm proxy fields
	/** 主 API 密钥 */
	readonly master_key?: string;
	/** 是否将模型配置存入数据库 */
	readonly store_model_in_db?: boolean;
	/** websearch 目标模型覆盖 */
	readonly websearch_override_target_model?: string;
	/** 是否跳过 provider token 计数 */
	readonly skip_provider_token_counting?: boolean;
	/** 数据库连接 URL */
	readonly database_url?: string;
	/**
	 * GAP: 是否禁止把 master key 哈希写入 DB。
	 * true 时 SpendTracker 在检测到请求由 master key 发起时，会跳过 api_key 写入（避免任何持久化）。
	 */
	readonly disable_adding_master_key_hash_to_db?: boolean;
	/** 是否在 SpendLogs 中存储 prompt/response/body，默认关闭 */
	readonly store_prompts_in_spend_logs?: boolean;
	/** 是否在 SpendLogs 中存储 Provider 实际请求/响应详情，默认关闭 */
	readonly store_upstream_logs_in_spend_logs?: boolean;
	/**
	 * 是否把 SpendLogs 的消息内容改写为内容寻址块引用（默认开启）。
	 * 关闭时回到优化前的整段 JSONB 存储；两种编码可以逐行混合存在。
	 */
	readonly spend_log_block_dedup?: boolean;
}

/** 服务配置 */
export interface ServiceConfig {
	/** 服务器配置 */
	readonly server: ServerConfig;
	/** 日志配置 */
	readonly logging: LoggingConfig;
	/** 数据库连接配置 */
	readonly database: DatabaseConfig;
	/** LiteLLM 核心设置 */
	readonly litellmSettings: LiteLLMSettings;
	/** 路由设置 */
	readonly routerSettings: RouterSettings;
	/** 通用设置 */
	readonly generalSettings: GeneralSettings;
	/** 原始 litellm_settings 内容 */
	readonly litellmSettingsRaw?: Record<string, unknown>;
	/** 原始 router_settings 内容 */
	readonly routerSettingsRaw?: Record<string, unknown>;
	/** 原始 general_settings 内容 */
	readonly generalSettingsRaw?: Record<string, unknown>;
}

// ============ 解析逻辑 ============

/**
 * 从 `general_settings.database_url` 解析数据库连接配置。
 * 支持 `postgresql://user:pass@host:port/database` 格式。
 * @param url
 */
function parseDatabaseUrl(url: string): DatabaseConfig | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
			return null;
		}
		const host = parsed.hostname;
		const portRaw = parsed.port;
		const port = portRaw && portRaw.length > 0 ? Number(portRaw) : 5432;
		if (Number.isNaN(port)) {
			return null;
		}
		const database = parsed.pathname.replace(/^\//, "") || "litellm";
		const user = parsed.username || "litellm";
		const password = parsed.password || "litellm";
		if (!host) {
			return null;
		}
		return {
			host: host,
			port: port,
			database: database,
			user: user,
			password: password,
			connectionString: url,
		};
	} catch {
		return null;
	}
}

/**
 * 验证并转换原始 YAML 数据为 ServiceConfig
 *
 * Python LiteLLM 风格 YAML（snake_case 顶层字段）作为一等输入：
 * - server.port → server.port → general_settings.port → 默认 4000
 * - server.host → server.host → general_settings.host → 默认 0.0.0.0
 * - database 顶层 → general_settings.database_url 解析 → 默认 localhost:5432
 * - generalSettings 派生自 general_settings（snake_case 优先，camelCase 仅作兼容回退）
 * - routerSettings 派生自 router_settings（snake_case 优先，camelCase 仅作兼容回退）
 * - litellmSettingsRaw/routerSettingsRaw/generalSettingsRaw 保留原始 Python 块
 *   （模型 / Alias / fallback 键已被剔除，不会流入 DB 默认值与设置页）
 * @param raw - 原始 YAML 对象
 * @throws 当配置不符合 schema 时抛出 ZodError
 */
export function validateAndTransform(raw: unknown): ServiceConfig {
	const config = RawServiceConfigSchema.parse(raw);

	const unsupportedKeys = findUnsupportedYamlKeys(raw);
	if (unsupportedKeys.length > 0) {
		logger.warn("config yaml 中的模型、Alias 与 fallback 配置已不再读取，已忽略；请在 Dashboard 或数据库中维护", {
			ignoredKeys: unsupportedKeys,
		});
	}

	const generalSettingsRaw = withoutUnsupportedSettings(
		config.general_settings as Record<string, unknown> | undefined,
		"general_settings",
	);
	const routerSettingsRaw = withoutUnsupportedSettings(config.router_settings as Record<string, unknown> | undefined, "router_settings");
	const litellmSettingsRaw = (config.litellm_settings ?? {}) as Record<string, unknown>;
	validateSpendMetadataFields(generalSettingsRaw["spend_logs_metadata_fields"]);
	validateKeyAliasSettings(litellmSettingsRaw);

	// server.port: APP_PORT → server.port → general_settings.port → 默认 4000
	let serverPort = config.server.port;
	if (typeof generalSettingsRaw["port"] === "number") {
		serverPort = generalSettingsRaw["port"];
	} else if (typeof generalSettingsRaw["port"] === "string") {
		const parsed = Number(generalSettingsRaw["port"]);
		if (Number.isNaN(parsed)) {
			throw new Error(`Invalid general_settings.port: expected number, got "${generalSettingsRaw["port"]}".`);
		}
		serverPort = parsed;
	}
	const envAppPort = process.env.APP_PORT;
	if (typeof envAppPort === "string" && envAppPort.length > 0) {
		const parsed = Number(envAppPort);
		if (Number.isNaN(parsed)) {
			throw new Error(`Invalid APP_PORT: expected number, got "${envAppPort}".`);
		}
		serverPort = parsed;
	}
	if (typeof serverPort !== "number" || Number.isNaN(serverPort)) {
		throw new Error(`Invalid server.port: expected number.`);
	}

	// server.host: server.host → general_settings.host → 默认 0.0.0.0
	let serverHost = config.server.host;
	if (typeof generalSettingsRaw["host"] === "string" && generalSettingsRaw["host"].length > 0) {
		serverHost = generalSettingsRaw["host"];
	}

	// database: 顶层 database → DATABASE_URL 环境变量 → general_settings.database_url → 默认值
	// 环境变量优先级高于 YAML，用于部署脚本注入真实数据库连接
	let databaseConfig: DatabaseConfig = { ...config.database };
	const envDatabaseUrl = process.env.DATABASE_URL;
	const yamlDatabaseUrl = generalSettingsRaw["database_url"];
	const envValid = typeof envDatabaseUrl === "string" && envDatabaseUrl.length > 0;
	const yamlValid = typeof yamlDatabaseUrl === "string" && yamlDatabaseUrl.length > 0;
	const databaseUrlRaw: string | undefined = envValid ? (envDatabaseUrl as string) : yamlValid ? (yamlDatabaseUrl as string) : undefined;
	if (databaseUrlRaw !== undefined) {
		const parsed = parseDatabaseUrl(databaseUrlRaw);
		if (!parsed) {
			const sourceLabel = envValid ? "DATABASE_URL" : "general_settings.database_url";
			throw new Error(`Invalid ${sourceLabel}: expected postgresql:// connection string.`);
		}
		databaseConfig = { ...databaseConfig, ...parsed };
	}
	const poolLimit = generalSettingsRaw["database_connection_pool_limit"];
	if (typeof poolLimit === "number") {
		databaseConfig = { ...databaseConfig, maxConnections: poolLimit };
	}

	// generalSettings: snake_case general_settings 派生，camelCase 仅作兼容回退（冲突时 snake_case 优先）
	// LITELLM_MASTER_KEY 环境变量优先于 YAML 与 camelCase 字段，供容器部署注入真实 master key
	const envMasterKey = process.env.LITELLM_MASTER_KEY;
	const envMasterKeyValid = typeof envMasterKey === "string" && envMasterKey.length > 0;
	const generalSettings: GeneralSettings = {
		...config.generalSettings,
		master_key: envMasterKeyValid
			? (envMasterKey as string)
			: ((generalSettingsRaw["master_key"] as string | undefined) ?? config.generalSettings.master_key),
		store_model_in_db:
			typeof generalSettingsRaw["store_model_in_db"] === "boolean"
				? (generalSettingsRaw["store_model_in_db"] as boolean)
				: config.generalSettings.store_model_in_db,
		websearch_override_target_model:
			(generalSettingsRaw["websearch_override_target_model"] as string | undefined) ??
			config.generalSettings.websearch_override_target_model,
		skip_provider_token_counting:
			typeof generalSettingsRaw["skip_provider_token_counting"] === "boolean"
				? (generalSettingsRaw["skip_provider_token_counting"] as boolean)
				: config.generalSettings.skip_provider_token_counting,
		database_url: (databaseUrlRaw as string | undefined) ?? config.generalSettings.database_url,
		disable_adding_master_key_hash_to_db:
			typeof generalSettingsRaw["disable_adding_master_key_hash_to_db"] === "boolean"
				? (generalSettingsRaw["disable_adding_master_key_hash_to_db"] as boolean)
				: config.generalSettings.disable_adding_master_key_hash_to_db,
		store_prompts_in_spend_logs:
			typeof generalSettingsRaw["store_prompts_in_spend_logs"] === "boolean"
				? (generalSettingsRaw["store_prompts_in_spend_logs"] as boolean)
				: config.generalSettings.store_prompts_in_spend_logs,
		store_upstream_logs_in_spend_logs:
			typeof generalSettingsRaw["store_upstream_logs_in_spend_logs"] === "boolean"
				? (generalSettingsRaw["store_upstream_logs_in_spend_logs"] as boolean)
				: config.generalSettings.store_upstream_logs_in_spend_logs,
		spend_log_block_dedup:
			typeof generalSettingsRaw["spend_log_block_dedup"] === "boolean"
				? (generalSettingsRaw["spend_log_block_dedup"] as boolean)
				: config.generalSettings.spend_log_block_dedup,
	};

	// routerSettings: snake_case router_settings 派生，camelCase 仅作兼容回退（冲突时 snake_case 优先）
	const routerSettings: RouterSettings = {
		...config.routerSettings,
		allowed_fails:
			typeof routerSettingsRaw["allowed_fails"] === "number"
				? (routerSettingsRaw["allowed_fails"] as number)
				: config.routerSettings.allowed_fails,
		cooldown_time:
			typeof routerSettingsRaw["cooldown_time"] === "number"
				? (routerSettingsRaw["cooldown_time"] as number)
				: config.routerSettings.cooldown_time,
		num_retries:
			typeof routerSettingsRaw["num_retries"] === "number"
				? (routerSettingsRaw["num_retries"] as number)
				: config.routerSettings.num_retries,
		routing_strategy: (routerSettingsRaw["routing_strategy"] as string | undefined) ?? config.routerSettings.routing_strategy,
		enable_pre_call_checks:
			typeof routerSettingsRaw["enable_pre_call_checks"] === "boolean"
				? (routerSettingsRaw["enable_pre_call_checks"] as boolean)
				: config.routerSettings.enable_pre_call_checks,
		redis_url: (routerSettingsRaw["redis_url"] as string | undefined) ?? config.routerSettings.redis_url,
		search_tools: Array.isArray(routerSettingsRaw["search_tools"])
			? (routerSettingsRaw["search_tools"] as Record<string, unknown>[])
			: config.routerSettings.search_tools,
		request_timeout:
			typeof routerSettingsRaw["request_timeout"] === "number"
				? (routerSettingsRaw["request_timeout"] as number)
				: config.routerSettings.request_timeout,
	};

	return {
		server: {
			port: serverPort,
			host: serverHost,
		},
		logging: config.logging,
		database: databaseConfig,
		litellmSettings: config.litellmSettings,
		routerSettings: routerSettings,
		generalSettings: generalSettings,
		litellmSettingsRaw: litellmSettingsRaw,
		routerSettingsRaw: routerSettingsRaw,
		generalSettingsRaw: generalSettingsRaw,
	};
}

/**
 * 从 YAML 文件加载配置
 * @param configPath - 配置文件路径
 * @throws 当文件不存在、格式错误或配置验证失败时抛出错误
 */
function loadYamlConfig(configPath: string): ServiceConfig {
	const fileContents = fs.readFileSync(configPath, "utf8");
	return validateAndTransform(yaml.load(fileContents));
}

/** 全局配置实例（延迟初始化） */
let configInstance: ServiceConfig | null = null;

/**
 * 从 YAML 文件加载配置
 * 优先使用环境变量 CONFIG_PATH，fallback 到当前工作目录的 config.yaml
 */
export function loadConfig(): ServiceConfig {
	const configPath = process.env.CONFIG_PATH ?? path.join(process.cwd(), "config.yaml");
	configInstance = loadYamlConfig(configPath);
	return configInstance;
}

/**
 * 获取配置实例（单例模式）
 * 首次调用时自动从默认路径加载
 */
export function getConfig(): ServiceConfig {
	if (configInstance === null) {
		configInstance = loadConfig();
	}
	return configInstance;
}

/**
 * 重置配置实例（用于测试）
 */
export function resetConfig(): void {
	configInstance = null;
}
