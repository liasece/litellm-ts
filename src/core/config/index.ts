/**
 * 服务配置管理模块
 * 从 YAML 文件读取配置，通过 zod schema 校验并提供类型安全的配置访问
 *
 * 支持的 YAML 结构（兼容 litellm 标准格式）：
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
 * model_list:
 *   - model_name: claude-opus-4-6
 *     litellm_params:
 *       model: anthropic/claude-opus-4-6
 *       api_base: http://...
 *       api_key: sk-...
 * litellm_settings:
 *   skip_provider_token_counting: true
 * router_settings:
 *   allowed_fails: 0
 *   cooldown_time: 300
 *   ...
 * general_settings:
 *   master_key: sk-...
 *   store_model_in_db: true
 *   model_group_alias:
 *     claude-opus: glm-latest-anthropic
 * ```
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { z } from "zod";

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
	/** 是否缓存模型配置 */
	cacheModelConfig: z.boolean().default(true),
});

/** litellm_params schema for model_list entries */
const ModelLitellmParamsSchema = z.object({
	model: z.string(),
	api_key: z.string().optional(),
	api_base: z.string().optional(),
	custom_llm_provider: z.string().optional(),
	rpm: z.number().optional(),
	tpm: z.number().optional(),
	input_cost_per_token: z.number().optional(),
	output_cost_per_token: z.number().optional(),
	timeout: z.number().optional(),
	max_retries: z.number().optional(),
	stream_timeout: z.number().optional(),
	temperature: z.number().optional(),
	max_tokens: z.number().optional(),
	extra_headers: z.record(z.string()).optional(),
	extra_body: z.record(z.unknown()).optional(),
});

/** Model info schema */
const ModelInfoSchema = z
	.object({
		id: z.string().optional(),
		mode: z.string().optional(),
		max_input_tokens: z.number().optional(),
		max_output_tokens: z.number().optional(),
		supports_function_calling: z.boolean().optional(),
		supports_parallel_function_calling: z.boolean().optional(),
		supports_vision: z.boolean().optional(),
		supports_system_messages: z.boolean().optional(),
		supports_tool_choice: z.boolean().optional(),
		input_cost_per_token: z.number().optional(),
		output_cost_per_token: z.number().optional(),
		litellm_provider: z.string().optional(),
	})
	.passthrough();

/** Model list item schema */
const ModelListItemSchema = z.object({
	model_name: z.string(),
	litellm_params: ModelLitellmParamsSchema,
	model_info: ModelInfoSchema.optional(),
});

/** Fallback config: { model_name: string[] } */
const FallbackConfigSchema = z.record(z.string(), z.array(z.string()));

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
	max_fallbacks: z.number().optional(),
	routing_strategy: z.string().optional(),
	fallbacks: z.array(FallbackConfigSchema).default([]),
	model_group_alias: z.record(z.string()).default({}),
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
	model_group_alias: z.record(z.string()).default({}),
	websearch_override_target_model: z.string().optional(),
	skip_provider_token_counting: z.boolean().optional(),
	database_url: z.string().optional(),
	database_connection_pool_limit: z.number().optional(),
	proxy_logging_retry_min_delay: z.number().optional(),
	max_log_files: z.number().optional(),
});

/** 顶层配置 schema */
const RawServiceConfigSchema = z.object({
	server: ServerSchema.default({}),
	logging: LoggingSchema.default({}),
	database: DatabaseSchema.default({}),
	litellmSettings: LiteLLMSettingsSchema.default({}),
	routerSettings: RouterSettingsSchema.default({}),
	generalSettings: GeneralSettingsSchema.default({}),

	// Litellm proxy top-level fields (snake_case)
	model_list: z.array(ModelListItemSchema).default([]),
	litellm_settings: z.record(z.unknown()).optional(),
	router_settings: z.record(z.unknown()).optional(),
	general_settings: z.record(z.unknown()).optional(),
});

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
	/** 数据库用户名 */
	readonly user: string;
	/** 数据库密码 */
	readonly password: string;
}

/** LiteLLM 核心设置 */
export interface LiteLLMSettings {
	/** 默认模型 */
	readonly defaultModel: string;
	/** 默认最大重试次数 */
	readonly maxRetries: number;
	/** 请求超时时间（毫秒） */
	readonly requestTimeoutMs: number;
	/** 是否缓存模型配置 */
	readonly cacheModelConfig: boolean;
}

/** Model litellm_params type */
export interface ModelLitellmParamsConfig {
	/** 完整模型标识符（含 provider 前缀） */
	readonly model: string;
	/** API 密钥 */
	readonly api_key?: string;
	/** API 基础 URL */
	readonly api_base?: string;
	/** 自定义 LLM 提供商标识 */
	readonly custom_llm_provider?: string;
	/** 每分钟请求数限制 */
	readonly rpm?: number;
	/** 每分钟 token 数限制 */
	readonly tpm?: number;
	/** 输入 token 单价 */
	readonly input_cost_per_token?: number;
	/** 输出 token 单价 */
	readonly output_cost_per_token?: number;
	/** 请求超时时间（秒） */
	readonly timeout?: number;
	/** 最大重试次数 */
	readonly max_retries?: number;
	/** 流式超时时间（秒） */
	readonly stream_timeout?: number;
	/** 温度参数 */
	readonly temperature?: number;
	/** 最大输出 token 数 */
	readonly max_tokens?: number;
	/** 额外请求头 */
	readonly extra_headers?: Record<string, string>;
	/** Provider-specific 额外参数 */
	readonly extra_body?: Record<string, unknown>;
}

/** Model list item config */
export interface ModelListItemConfig {
	/** 逻辑模型名称（对用户暴露的名称） */
	readonly model_name: string;
	/** 部署连接参数 */
	readonly litellm_params: ModelLitellmParamsConfig;
	/** 模型元信息 */
	readonly model_info?: Record<string, unknown>;
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
	/** 最大回退深度 */
	readonly max_fallbacks?: number;
	/** 路由策略名称 */
	readonly routing_strategy?: string;
	/** 降级配置列表 */
	readonly fallbacks: Record<string, string[]>[];
	/** 模型组别名映射 */
	readonly model_group_alias: Record<string, string>;
	/** 启用请求前预检 */
	readonly enable_pre_call_checks?: boolean;
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
	/** 模型组别名映射 */
	readonly model_group_alias: Record<string, string>;
	/** websearch 目标模型覆盖 */
	readonly websearch_override_target_model?: string;
	/** 是否跳过 provider token 计数 */
	readonly skip_provider_token_counting?: boolean;
	/** 数据库连接 URL */
	readonly database_url?: string;
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
	/** 模型列表（litellm proxy） */
	readonly modelList: ModelListItemConfig[];
	/** 原始 litellm_settings 内容 */
	readonly litellmSettingsRaw?: Record<string, unknown>;
	/** 原始 router_settings 内容 */
	readonly routerSettingsRaw?: Record<string, unknown>;
	/** 原始 general_settings 内容 */
	readonly generalSettingsRaw?: Record<string, unknown>;
}

// ============ 解析逻辑 ============

/**
 * 验证并转换原始 YAML 数据为 ServiceConfig
 * @param raw - 原始 YAML 对象
 * @throws 当配置不符合 schema 时抛出 ZodError
 */
export function validateAndTransform(raw: unknown): ServiceConfig {
	const config = RawServiceConfigSchema.parse(raw);

	return {
		server: config.server,
		logging: config.logging,
		database: config.database,
		litellmSettings: config.litellmSettings,
		routerSettings: config.routerSettings,
		generalSettings: config.generalSettings,
		modelList: config.model_list,
		litellmSettingsRaw: config.litellm_settings,
		routerSettingsRaw: config.router_settings,
		generalSettingsRaw: config.general_settings,
	};
}

/**
 * 从 YAML 文件加载配置
 * @param configPath - 配置文件路径
 * @throws 当文件不存在、格式错误或配置验证失败时抛出错误
 */
function loadYamlConfig(configPath: string): ServiceConfig {
	const fileContents = fs.readFileSync(configPath, "utf8");
	const raw = yaml.load(fileContents);
	return validateAndTransform(raw);
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
