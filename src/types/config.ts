/**
 * LiteLLM YAML 配置类型
 *
 * 完整映射 LiteLLM proxy config.yaml 的结构。
 * 参考: LiteLLM Python litellm/proxy/proxy_server.py
 */

/** 模型元信息 */
export interface ModelInfo {
	/** 模型唯一标识 */
	id?: string;
	/** 模型模式： "chat" | "completion" | "embedding" | "image_generation" | "audio_transcription" | "responses" */
	mode?: string;
	/** 最大输入 token 数 */
	max_input_tokens?: number;
	/** 最大输出 token 数 */
	max_output_tokens?: number;
	/** 是否支持函数调用 */
	supports_function_calling?: boolean;
	/** 是否支持并行函数调用 */
	supports_parallel_function_calling?: boolean;
	/** 是否支持视觉输入 */
	supports_vision?: boolean;
	/** 是否支持 system 消息 */
	supports_system_messages?: boolean;
	/** 是否支持工具选择 */
	supports_tool_choice?: boolean;
	/** 输入 token 单价 */
	input_cost_per_token?: number;
	/** 输出 token 单价 */
	output_cost_per_token?: number;
	/** Provider 名称 */
	litellm_provider?: string;
	/** 每分钟 token 限制 */
	tpm?: number;
	/** 每分钟请求限制 */
	rpm?: number;
	/** 部署区域（PY 区域过滤用），如 "us-east-1", "eu-west-1" */
	region?: string;
	/** 是否支持 response_format（结构化输出） */
	supports_response_format?: boolean;
}

/** 模型列表项 — litellm_params 部分 */
export interface ModelLitellmParams {
	/** 完整模型标识符（含 provider 前缀） */
	model: string;
	/** API 密钥 */
	api_key?: string;
	/** API 基础 URL */
	api_base?: string;
	/** 自定义 LLM 提供商标识 */
	custom_llm_provider?: string;
	/** 每分钟请求数限制 */
	rpm?: number;
	/** 每分钟 token 数限制 */
	tpm?: number;
	/** 输入 token 单价 */
	input_cost_per_token?: number;
	/** 输出 token 单价 */
	output_cost_per_token?: number;
	/** 输入 token 单价（缓存创建） */
	input_cost_per_token_cache_creation?: number;
	/** 输入 token 单价（缓存读取） */
	input_cost_per_token_cache_read?: number;
	/** 请求超时时间（秒） */
	timeout?: number;
	/** 最大重试次数 */
	max_retries?: number;
	/** 流式超时时间（秒） */
	stream_timeout?: number;
	/** 温度 */
	temperature?: number;
	/** 最大输出 token 数 */
	max_tokens?: number;
	/** 额外请求头 */
	extra_headers?: Record<string, string>;
	/** Provider-specific 额外参数 */
	extra_body?: Record<string, unknown>;
}

/** 模型列表项 */
export interface ModelListItem {
	/** 对外暴露的逻辑模型名称 */
	model_name: string;
	/** 模型连接参数 */
	litellm_params: ModelLitellmParams;

	/** 模型元信息 */
	model_info?: ModelInfo;
}

/** 降级配置：模型到备选模型列表的映射 */
export interface FallbackConfig {
	/** 模型名 → 备选模型名列表 */
	[model_name: string]: string[];
}

/** litellm_settings 部分 */
export interface LitellmSettings {
	/** 成功回调 */
	success_callback?: string[];
	/** 失败回调 */
	failure_callback?: string[];
	/** 是否启用缓存 */
	cache?: boolean;
	/** 失败重试次数 */
	num_retries?: number;
	/** 请求超时时间（秒） */
	request_timeout?: number;
	/** 是否启用详细日志 */
	set_verbose?: boolean;
	/** 回退到原始模型的 API base */
	fallback_to_original_model?: boolean;
	/** 自定义 provider 映射 */
	custom_provider_map?: Array<{
		provider: string;
		api_base: string;
	}>;
}

/** router_settings 部分 */
export interface RouterSettings {
	/** 路由策略 */
	routing_strategy?: string;
	/** 允许的最大失败数 */
	allowed_fails?: number;
	/** 重试次数 */
	num_retries?: number;
	/** 降级配置 */
	fallbacks?: FallbackConfig[];
	/** 冷却时间（秒） */
	cooldown_time?: number;
	/** 请求超时 */
	request_timeout?: number;
	/** Redis URL */
	redis_url?: string;
}

/** 网页搜索拦截参数 */
export interface WebSearchInterceptionParams {
	/** Google PSE API 密钥 */
	google_pse_api_key?: string;
	/** Google PSE 引擎 ID */
	google_pse_engine_id?: string;
}

/** general_settings 部分 */
export interface GeneralSettings {
	/** 主密钥（用于管理 API） */
	master_key?: string;
	/** 数据库连接 URL */
	database_url?: string;
	/** 是否在数据库中存储模型配置 */
	store_model_in_db?: boolean;
	/** 是否跳过 provider 的 token 计数 */
	skip_provider_token_counting?: boolean;
	/** 网页搜索拦截参数 */
	websearch_interception_params?: WebSearchInterceptionParams;
	/** 网页搜索覆写目标模型 */
	websearch_override_target_model?: string;
	/** 模型组别名（支持 PY RouterModelGroupAliasItem 结构） */
	model_group_alias?: Record<string, string | { model: string; hidden?: boolean }>;
	/** 数据库连接池大小 */
	database_connection_pool_limit?: number;
	/** 代理设置 */
	proxy_logging_retry_min_delay?: number;
	/** 日志轮转设置 */
	max_log_files?: number;
}

/** 环境变量覆盖 */
export interface EnvironmentVariables {
	/** 键值对 */
	[key: string]: string;
}

/** 完整 LiteLLM YAML 配置 */
export interface LitellmConfig {
	/** 模型列表 */
	model_list: ModelListItem[];
	/** LiteLLM 全局设置 */
	litellm_settings?: LitellmSettings;
	/** Router 设置 */
	router_settings?: RouterSettings;
	/** 通用设置 */
	general_settings?: GeneralSettings;
	/** 环境变量覆写 */
	environment_variables?: EnvironmentVariables;
}
