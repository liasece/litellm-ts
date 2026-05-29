/**
 * LiteLLM Router 配置类型
 *
 * 定义路由器所需的模型部署、路由策略和降级配置。
 */

import type { ModelInfo } from "./config";

/** 路由策略名称（单一来源，消除与 RoutingStrategies.ts 重复字符串联合） */
export enum RoutingStrategyName {
	/** 简单随机洗牌：均匀随机选择 deployment，对齐 PY `simple-shuffle` */
	SimpleShuffle = "simple-shuffle",
	/** 最闲优先：选择当前活跃请求数最少的 deployment，对齐 PY `least-busy` */
	LeastBusy = "least-busy",
	/** RPM/TPM 最低优先：选择当前 60s 窗口内 RPM/TPM 占用最低的 deployment，对齐 PY `usage-based-routing` */
	UsageBasedRouting = "usage-based-routing",
	/** 延迟最低优先：按历史平均延迟 + 缓冲区排序，对齐 PY `latency-based-routing` */
	LatencyBasedRouting = "latency-based-routing",
	/** 成本最低优先：按 per-token 成本排序，对齐 PY `cost-based-routing` */
	CostBasedRouting = "cost-based-routing",
	/** 改进版 usage-based：RPM/TPM + 失败率 + 延迟综合评分，对齐 PY `usage-based-routing-v2` */
	UsageBasedRoutingV2 = "usage-based-routing-v2",
}

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
	/**
	 * COOLDOWN-001: 部署级冷却允许失败次数白名单（对齐 PY `cooldown_allowed_fails`）。
	 * 当 set 时优先于 router 级的 `allowed_fails`。可以是 number（统一阈值）
	 * 或 AllowedFailsPolicy（按异常类型分类阈值）。
	 */
	cooldown_allowed_fails?: number | AllowedFailsPolicy;
	/**
	 * GAP 6: 部署级 per-token 自定义成本，覆盖 PRICE_TABLE（PY `custom_cost_per_token`）。
	 * 当任一字段设置后，costPerToken 走 custom 路径；input/output 必填才计费，
	 * cache 字段可选。
	 */
	custom_cost_per_token?: {
		/** 输入 token 单价（每 token） */
		input_cost_per_token?: number;
		/** 输出 token 单价（每 token） */
		output_cost_per_token?: number;
		/** cache 写入单价（每 token） */
		cache_creation_input_token_cost?: number;
		/** cache 读取单价（每 token） */
		cache_read_input_token_cost?: number;
	};
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

/** 模型组别名值类型：单个模型名、模型名列表、或 RouterModelGroupAliasItem */
export type RouterModelGroupAliasValue = string | string[] | RouterModelGroupAliasItem;

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
	routing_strategy: RoutingStrategyName;
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

	/**
	 * DIFF-RT-01 / DIFF-014: 冷却事件回调列表，对齐 PY
	 * `router.cooldown_callbacks: List[CooldownEventCallback]`。
	 * 每次 markFailed 触发后，CooldownManager 遍历执行这些回调（Prometheus / Slack alert）。
	 * 回调签名: `(deploymentId, cooldownDurationMs, statusCode, exceptionReceived) => void | Promise<void>`。
	 *
	 * DIFF-014: 支持同步 / 异步回调；异步回调走 fire-and-forget Promise.catch，不阻塞主路径。
	 * 失败被吞，不影响主路径。
	 */
	cooldown_callbacks?: Array<
		(deploymentId: string, cooldownDurationMs: number, statusCode: number, exceptionReceived: string) => void | Promise<void>
	>;

	/**
	 * DIFF-RT-CALLBACKS-01: 路由器执行生命周期回调（对齐 PY
	 * `router.deployment_callback_on_success` / `deployment_callback_on_failure` /
	 * `log_retry_event` — router.py:5984-6200）。
	 *
	 * 与 cooldown_callbacks 区别：
	 *   - cooldown_callbacks 关注的是「节点被标记为失败」的冷却事件（用于报警 / metrics）
	 *   - router_callbacks 关注的是「请求级」的执行进度（用于业务侧自定义日志 / tracing）
	 */
	router_callbacks?: RouterCallbacks;

	/**
	 * DIFF-RT-ALIAS-02: RouterConfig 透传 model_group_alias（PY `router.py:573-583`）。
	 * 之前别名只通过 Router constructor 第二个参数注入，配置文件中无法声明。
	 * 键为逻辑名（如 "gpt-4o"），值为 `RouterModelGroupAliasValue`：
	 *   - `string`               — 单一目标模型名
	 *   - `string[]`             — 候选列表（取首个派发）
	 *   - `RouterModelGroupAliasItem` — `{ model, hidden }` 对象
	 *
	 * 当 Router constructor 同时收到第二参数时，constructor 参数优先；否则用本字段。
	 */
	model_group_alias?: Record<string, RouterModelGroupAliasValue>;

	/**
	 * DIFF-012: 可选 Redis-like 客户端，启用分布式 cooldown 同步。
	 * 当提供时，Router 会构造 `RedisCooldownBackend` 并注入 CooldownManager，
	 * 让多实例部署共享冷却状态（对齐 PY `CooldownCache` DualCache 行为）。
	 *
	 * 接口仅要求最小 `RedisLike`（set/get/del/expire），方便注入 ioredis / 自定义 mock。
	 * 本地内联避免 router/RedisCooldownBackend ↔ types/router 循环依赖。
	 */
	redis_cooldown_client?: {
		set(key: string, value: string, ...args: unknown[]): Promise<unknown> | unknown;
		get(key: string): Promise<string | null> | string | null;
		del(key: string): Promise<unknown> | unknown;
		expire(key: string, seconds: number): Promise<unknown> | unknown;
	};
}

/**
 * DIFF-RT-CALLBACKS-01: 路由器回调签名（对齐 PY router.callbacks）。
 *
 * 调用时机：
 *   - onSuccess — 单次请求成功（status < 400 / 无异常）后触发
 *   - onFailure — 全部 retry 耗尽后，最终失败时触发（previousError 已传递）
 *   - onRetry   — 触发 retry 决策时触发（429/5xx 等可重试错误，attempt 计数 ≥ 1）
 *
 * 回调异常被吞，不影响主路径（与 PY async 行为一致）。
 */
export interface RouterCallbacks {
	/**
	 * 请求成功完成
	 * @param deployment - 命中的 deployment
	 * @param response - Provider 响应对象
	 * @param latencyMs - 总耗时（毫秒）
	 */
	onSuccess?(deployment: Deployment, response: unknown, latencyMs: number): void;
	/**
	 * 请求最终失败（所有 retry 用完 + 无 fallback 接管）
	 * @param deployment - 最后尝试的 deployment
	 * @param error - 失败原因
	 */
	onFailure?(deployment: Deployment, error: Error): void;
	/**
	 * 触发 retry 决策时调用
	 * @param deployment - 当前 deployment
	 * @param attempt - 当前 retry 次数（0-based, 0 表示首次失败后第一次 retry）
	 * @param error - 触发 retry 的错误
	 */
	onRetry?(deployment: Deployment, attempt: number, error: Error): void;
}
