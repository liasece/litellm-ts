/**
 * LiteLLM Router 配置类型
 *
 * 定义路由器所需的模型部署、路由策略和降级配置。
 */

import type { ModelInfo } from "./config";

/** 路由策略 */
export type RoutingStrategy =
	| "simple-shuffle"
	| "least-busy"
	| "usage-based-routing"
	| "latency-based-routing"
	| "cost-based-routing"
	| "usage-based-routing-v2";

/** 模型部署参数 */
export interface LitellmParams {
	/** 完整模型标识符（含 provider 前缀，如 "openai/gpt-4"） */
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
	/** 请求超时时间（秒） */
	timeout?: number;
	/** 输入 token 单价 */
	input_cost_per_token?: number;
	/** 输出 token 单价 */
	output_cost_per_token?: number;
	/** 模型权重（用于 weighted 路由策略） */
	weight?: number;
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
	/** 部署级冷却时间（秒），覆盖全局设置 */
	cooldown_time?: number;
	/** 部署级重试次数，覆盖全局设置 */
	num_retries?: number;
	/** 延迟路由策略的缓冲区比例（毫秒），对齐 PY lowest_latency_buffer */
	lowest_latency_buffer?: number;
}

/** 某模型的一个部署实例（一个 API 端点/密钥） */
export interface Deployment {
	/** 逻辑模型名称（对用户暴露的名称） */
	model_name: string;
	/** 部署连接参数 */
	litellm_params: LitellmParams;
	/** 模型元信息 */
	model_info?: ModelInfo;
	/** PY: 部署级 TPM 限制（在 litellm_params 之外） */
	tpm?: number;
	/** PY: 部署级 RPM 限制（在 litellm_params 之外） */
	rpm?: number;
}

/** 降级配置：模型名到备选模型名列表的映射 */
export interface FallbackConfig {
	/** 模型名到降级目标列表的映射 */
	[model_name: string]: string[];
}

/** 按异常类型的重试策略配置，每种异常可独立设置重试次数 */
export interface RetryPolicy {
	/** 400 错误重试次数 */
	BadRequestErrorRetries?: number | null;
	/** 401/403 认证错误重试次数 */
	AuthenticationErrorRetries?: number | null;
	/** 超时错误重试次数 */
	TimeoutErrorRetries?: number | null;
	/** 429 限流错误重试次数 */
	RateLimitErrorRetries?: number | null;
	/** 内容策略违规重试次数 */
	ContentPolicyViolationErrorRetries?: number | null;
	/** 5xx 服务端错误重试次数 */
	InternalServerErrorRetries?: number | null;
}

/** 模型组别名项，对齐 PY RouterModelGroupAliasItem TypedDict */
export interface RouterModelGroupAliasItem {
	/** 别名映射的真实模型名 */
	model: string;
	/** 是否在可用模型列表中隐藏此别名（PY TypedDict 为必填 bool） */
	hidden: boolean;
}

/** 按异常类型配置的允许失败策略，对齐 PY AllowedFailsPolicy TypedDict */
export interface AllowedFailsPolicy {
	/** 400 错误允许失败数 */
	BadRequestError?: number;
	/** 401/403 认证错误允许失败数 */
	AuthenticationError?: number;
	/** 超时错误允许失败数 */
	TimeoutError?: number;
	/** 429 限流错误允许失败数 */
	RateLimitError?: number;
	/** 内容策略违规允许失败数 */
	ContentPolicyViolationError?: number;
	/** 5xx 服务端错误允许失败数，对齐 PY InternalServerErrorAllowedFails */
	InternalServerErrorAllowedFails?: number;
}

/** Router 配置 */
export interface RouterConfig {
	/** 模型部署列表 */
	model_list: Deployment[];
	/** 路由策略 */
	routing_strategy: RoutingStrategy;
	/** 失败重试次数 */
	num_retries: number;
	/** 降级配置 */
	fallbacks?: FallbackConfig[];
	/** 默认降级列表，自动加到 fallbacks 的通配符 * 条目，对齐 PY default_fallbacks */
	default_fallbacks?: string[];
	/** Redis 连接 URL（用于分布式速率限制） */
	redis_url?: string;
	/** 请求超时时间（秒） */
	request_timeout?: number;
	/** 允许的最大失败数后进入冷却（也支持按异常类型配置的 AllowedFailsPolicy） */
	allowed_fails?: number | AllowedFailsPolicy;
	/** 冷却时间（秒） */
	cooldown_time?: number;
	/** 是否启用缓存 */
	cache?: boolean;
	/** 禁用冷却机制（调试用） */
	disable_cooldowns?: boolean;
	/** 上下文窗口溢出时的专属回退链 */
	context_window_fallbacks?: Record<string, string[]>;
	/** 内容策略违规时的专属回退链 */
	content_policy_fallbacks?: Record<string, string[]>;
	/** 全局重试策略配置 */
	retry_policy?: RetryPolicy;
	/** 按模型组指定重试策略 */
	model_group_retry_policy?: Record<string, RetryPolicy>;
	/** 最大回退深度，默认 5 */
	max_fallbacks?: number;
	/** 启用请求前限流预检 */
	pre_call_checks?: boolean;
	/**
	 * 退避重试的最小超时（秒），对齐 PY retry_after / min_timeout。
	 * 控制 _calculateBackoff 的退避基数下限。
	 */
	retry_after?: number;
	/**
	 * 可选预检配置，对齐 PY OptionalPreCallChecks。
	 * 当 pre_call_checks 启用时，用此对象精确控制各检查项的开关。
	 */
	optional_pre_call_checks?: {
		deployment_affinity?: boolean;
		session_affinity?: boolean;
		responses_api?: boolean;
		model_rate_limit?: boolean;
		prompt_caching?: boolean;
		router_budget_limiting?: boolean;
	};
	/**
	 * 全局模型成本映射表，对齐 PY litellm.model_cost。
	 * key: 模型 name（如 gpt-4）, value: { input_cost_per_token, output_cost_per_token }。
	 * costBasedRouting 在 litellm_params 和 model_info 均无成本数据时查找此表。
	 */
	model_cost_map?: Record<string, { input_cost_per_token: number; output_cost_per_token: number }>;
}
