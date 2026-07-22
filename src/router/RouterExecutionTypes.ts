/**
 * RouterExecution 共享类型 —— 把 RouterExecContext / ExecutionRequest /
 * helpers 等抽到独立模块，避免 RouterExecutionFallbackDispatch.ts 反向 import
 * RouterExecution.ts 导致循环依赖。
 *
 * 本模块仅声明类型，不持有任何运行时实现。
 */

import type { Deployment, RetryPolicy, RouterCallbacks } from "../types/router";
import type { ProviderConfig } from "../types/provider";
import type { CooldownManager } from "./CooldownManager";
import type { TPMRPMLimiter } from "./TPMRPMLimiter";
import type { FallbackHandler } from "./FallbackHandler";

/** Router 内部状态/方法的可注入视图，_executeWithFallback 唯一访问面 */
export interface RouterExecContext {
	/** 全部署列表 */
	deployments: Deployment[];
	/** 冷却状态管理者 */
	cooldownManager: CooldownManager;
	/** TPM/RPM 限流器 */
	tpmRpmLimiter: TPMRPMLimiter;
	/** 降级链解析器 */
	fallbackHandler: FallbackHandler;
	/** provider 配置注册表 */
	providerRegistry: { getProvider(model: string, custom?: string): ProviderConfig };
	/** 各 deployment 活跃请求计数 */
	activeRequests: Map<string, number>;
	/** 各 deployment 平均延迟（毫秒） */
	latencies: Map<string, number>;
	/** 各 deployment 最近 N 次延迟采样（滑动窗口） */
	latencySamples: Map<string, number[]>;
	/** 各 deployment time-to-first-token（毫秒） */
	ttft: Map<string, number>;
	/** 各 deployment 累计请求数 */
	totalCalls: Map<string, number>;
	/** 各 deployment 累计成功数 */
	successCalls: Map<string, number>;
	/** 各 deployment 累计失败数 */
	failCalls: Map<string, number>;
	/** router 生命周期回调（onSuccess/onFailure/onRetry） */
	routerCallbacks: RouterCallbacks | undefined;
	/** 全局重试策略 */
	retryPolicy: RetryPolicy | undefined;
	/** 按模型组重试策略 */
	modelGroupRetryPolicy: Record<string, RetryPolicy> | undefined;
	/** 默认重试次数（per-deployment num_retries 未设置时使用） */
	numRetries: number;
	/** 最大回退深度 */
	maxFallbacks: number;
	/** 是否启用 pre_call_checks（TPM/RPM pre-reserve + max_input_tokens 校验） */
	preCallChecks: boolean;
	/** 细粒度 pre_call_checks 开关（deployment_affinity/model_rate_limit 等） */
	optionalPreCallChecks: Record<string, boolean> | undefined;
	/**
	 * retry_after（秒），退避计算时作为下限基数（cooldownTimeMs 是 deployment-level
	 *  配置，**不要** 当作 minTimeoutMs 传入 calculateBackoff）。
	 */
	retryAfter: number;
	/** 默认冷却时间（毫秒） */
	cooldownTimeMs: number;
	/** 滑动窗口大小（latencySamples 长度） */
	recentLatencyCount: number;
	/** 失败路径上的延迟惩罚（秒），对齐 PY 1000 */
	failureLatencyPenaltySec: number;
}

/** 主循环请求体 */
export interface ExecutionRequest {
	/** 逻辑模型名（用户传入） */
	model: string;
	/** 消息列表（OpenAI 风格） */
	messages: {
		/** 角色 */
		role: string;
		/** 消息内容 */
		content: string | null;
	}[];
	/** 请求参数（stream/temperature/...） */
	optionalParams: Record<string, unknown>;
	/** 当前回退深度（每次走 fallback chain +1） */
	fallbackDepth: number;
	/** 上一轮执行的异常（mock 入口或 catch 块捕获） */
	previousError?: Error;
}

/** getAvailableDeployment 抽象，Router 主类提供以复用 routingStrategy + provider 选择 */
export type GetCandidateFn = (
	model: string,
	messages: { role: string; content: string | null }[],
) => { deployment: Deployment; provider: ProviderConfig } | null;

/** 实时计算 estimated tokens 的回调 */
export type EstimateInputTokensFn = (messages: { role: string; content: string | null }[]) => number;

/** 走 fetch 实际执行请求的回调（Router._executeRequest 抽出） */
export type ExecuteRequestFn = (
	provider: ProviderConfig,
	deployment: Deployment,
	messages: { role: string; content: string | null }[],
	optionalParams: Record<string, unknown>,
) => Promise<{ response: Response; body: unknown; ttft: number; stream?: AsyncGenerator<unknown>; upstreamUrl: string }>;

/** pattern match 抽象（用于 hydrateFromBackend 时过滤 candidate deployments） */
export type MatchDeploymentPatternFn = (dep: Deployment, model: string) => boolean;

/** 获取当前组 healthy 部署（hydrate + filter）。Router._getDeploymentsForModel 同等。 */
export type GetHealthyDeploymentsFn = (model: string) => Deployment[];

/** executeWithFallback 注入的全部回调（聚合 5 个 helper 引用） */
export interface ExecutionHelpers {
	/** 选取一个可用 deployment + provider */
	getCandidate: GetCandidateFn;
	/** 估算 messages 的 input tokens 数 */
	estimateInputTokens: EstimateInputTokensFn;
	/** 走 fetch 实际执行请求 */
	executeRequest: ExecuteRequestFn;
	/** deployment pattern match（hydrateFromBackend 过滤 candidate 用） */
	matchDeploymentPattern: MatchDeploymentPatternFn;
	/** 当前模型组健康部署列表（backoff 决策与 shouldRetry 判定） */
	getHealthyDeployments: GetHealthyDeploymentsFn;
}

/**
 * 处理 mock_testing_* 入口异常（CW / CP fallback chain 派发）。
 * 返回最终处理结果（either fallback chain 接管，或抛 mock exception）。
 */
export type DispatchMockPreviousErrorFn = (
	model: string,
	messages: { role: string; content: string | null }[],
	optionalParams: Record<string, unknown>,
	previousError: Error,
) => Promise<Record<string, unknown>> | null;
