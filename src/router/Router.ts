/**
 * LiteLLM Router — 主类。
 * 持有 deployments / cooldown / tpmRpmLimiter / fallbackHandler / providerRegistry；
 * 对外暴露 completion / acompletion / getAvailableDeployment；
 * 内部 _executeWithFallback 主循环委托给 RouterExecution.executeWithFallback。
 *
 * DIFF-T18: 7 个内部 helper（shouldRetryThisError / timeToSleepBeforeRetry / ...）
 * 抽到 RouterTestDelegates.ts；Router.ts 只保留公共 API 与 execute 主循环编排。
 */

import type { Deployment, RouterConfig, RouterModelGroupAliasValue, RouterCallbacks } from "../types/router";
import type { ProviderConfig as ProviderConfigType } from "../types/provider";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { CooldownManager } from "./CooldownManager";
import { TPMRPMLimiter } from "./TPMRPMLimiter";
import { FallbackHandler } from "./FallbackHandler";
import { RedisCooldownBackend } from "./RedisCooldownBackend";
import { extractProviderHeaders } from "./RouterResponseHeaders";
import { buildStreamWithTtft } from "./RouterStreamWrapper";
import {
	simpleShuffle,
	leastBusy,
	usageBasedRouting,
	latencyBasedRouting,
	costBasedRouting,
	usageBasedRoutingV2,
} from "./RoutingStrategies";
import type { RoutingContext } from "./RoutingStrategies";
import { logger } from "../core/utils/logger";
import { RouterCompletionSyncRemovedError } from "./RouterErrors";
import { getDeploymentKey } from "./RouterModelGroupCache";
import { normalizeMockTestingParams, tryDispatchMockTestingExceptions, shouldDispatchMockRateLimit } from "./RouterMockTesting";
import { executeWithFallback, type RouterExecContext } from "./RouterExecution";
import { RoutingStrategyName } from "../types/router";

type RouteFn = (deployments: Deployment[], ctx: RoutingContext) => Deployment | null;

interface Message {
	role: string;
	content: string | null;
}

interface ExecResult {
	response: Response;
	body: unknown;
	ttft: number;
	stream?: AsyncGenerator<unknown>;
}

interface AvailDeployment {
	deployment: Deployment;
	provider: ProviderConfigType;
}

const STRATEGY_MAP: Record<string, RouteFn> = {
	[RoutingStrategyName.SimpleShuffle]: simpleShuffle,
	[RoutingStrategyName.LeastBusy]: leastBusy,
	[RoutingStrategyName.UsageBasedRouting]: usageBasedRouting,
	[RoutingStrategyName.LatencyBasedRouting]: latencyBasedRouting,
	[RoutingStrategyName.CostBasedRouting]: costBasedRouting,
	[RoutingStrategyName.UsageBasedRoutingV2]: usageBasedRoutingV2,
};

const RECENT_LATENCY_COUNT = 10;
const CHARS_PER_TOKEN = 3.5;
const ESTIMATED_TOKENS_OVERHEAD = 10;
const FAILURE_LATENCY_PENALTY_SEC = 1000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_FALLBACKS = 5;
/**
 * `completionSync` 已废弃，保留参数签名仅为兼容。
 * 该常量是历史默认超时（毫秒），保留为常量是为了避免在签名里出现裸魔法数。
 */
const DEFAULT_COMPLETION_SYNC_TIMEOUT_MS = 60_000;

/**
 * LiteLLM Router 入口。
 * 持有 model_list 派发 + fallback chain + cooldown + TPM/RPM 限流等状态；
 * 公共 API：getDeployments / getAvailableDeployment / completion / acompletion / completionSync。
 */
export class Router {
	private readonly _deployments: Deployment[];
	private readonly _cooldownManager: CooldownManager;
	private readonly _tpmRpmLimiter: TPMRPMLimiter;
	private readonly _fallbackHandler: FallbackHandler;
	private readonly _providerRegistry: ProviderRegistry;
	private readonly _routeFn: RouteFn;
	private readonly _cooldownTimeMs: number;
	private readonly _numRetries: number;
	private readonly _modelGroupAlias: Record<string, RouterModelGroupAliasValue>;
	private readonly _disableCooldowns: boolean;
	private readonly _contextWindowFallbacks: Record<string, string[]>;
	private readonly _contentPolicyFallbacks: Record<string, string[]>;
	private readonly _retryPolicy;
	private readonly _modelGroupRetryPolicy;
	private readonly _maxFallbacks: number;
	private readonly _preCallChecks: boolean;
	private readonly _optionalPreCallChecks: Record<string, boolean> | undefined;
	private readonly _retryAfter: number;
	private readonly _modelCostMap: Record<string, { input_cost_per_token: number; output_cost_per_token: number }> | undefined;
	private readonly _routerCallbacks: RouterCallbacks | undefined;

	private readonly _activeRequests: Map<string, number> = new Map();
	private readonly _latencies: Map<string, number> = new Map();
	private readonly _previousModels: Map<string, number[]> = new Map();
	private readonly _totalCalls: Map<string, number> = new Map();
	private readonly _successCalls: Map<string, number> = new Map();
	private readonly _failCalls: Map<string, number> = new Map();
	private readonly _ttft: Map<string, number> = new Map();
	private readonly _latencySamples: Map<string, number[]> = new Map();

	constructor(config: RouterConfig, modelGroupAlias?: Record<string, RouterModelGroupAliasValue>) {
		this._deployments = [...config.model_list];
		this._cooldownTimeMs = (config.cooldown_time != null && config.cooldown_time > 0 ? config.cooldown_time : 5) * 1000;
		this._numRetries = config.num_retries != null && config.num_retries > 0 ? config.num_retries : DEFAULT_MAX_RETRIES;
		this._modelGroupAlias = modelGroupAlias ?? config.model_group_alias ?? {};
		this._disableCooldowns = config.disable_cooldowns ?? false;
		this._contextWindowFallbacks = config.context_window_fallbacks ?? {};
		this._contentPolicyFallbacks = config.content_policy_fallbacks ?? {};
		this._retryPolicy = config.retry_policy;
		this._modelGroupRetryPolicy = config.model_group_retry_policy;
		this._maxFallbacks = config.max_fallbacks != null && config.max_fallbacks > 0 ? config.max_fallbacks : DEFAULT_MAX_FALLBACKS;
		this._preCallChecks = config.pre_call_checks ?? false;
		this._optionalPreCallChecks = config.optional_pre_call_checks;
		this._retryAfter = config.retry_after ?? 0;
		this._modelCostMap = config.model_cost_map;
		this._routerCallbacks = config.router_callbacks;

		const providerDefaultDeploymentIds: string[] = [];
		for (const dep of config.model_list) {
			if (dep.model_info?.id && dep.model_info?.mode === "default") {
				providerDefaultDeploymentIds.push(dep.model_info.id);
			}
		}
		this._cooldownManager = new CooldownManager(
			this._disableCooldowns,
			config.allowed_fails,
			providerDefaultDeploymentIds,
			this._cooldownTimeMs,
			config.redis_cooldown_client ? new RedisCooldownBackend(config.redis_cooldown_client) : undefined,
			config.cooldown_callbacks,
		);
		this._tpmRpmLimiter = new TPMRPMLimiter();
		this._providerRegistry = new ProviderRegistry();

		const mergedFallbacks: Record<string, string[]> = {};
		for (const fb of config.fallbacks ?? []) {
			for (const [key, vals] of Object.entries(fb)) {
				if (!(key in mergedFallbacks)) {
					mergedFallbacks[key] = vals;
				}
			}
		}
		if (config.default_fallbacks && config.default_fallbacks.length > 0) {
			mergedFallbacks["*"] = config.default_fallbacks;
		}
		this._fallbackHandler = new FallbackHandler(
			mergedFallbacks,
			this._modelGroupAlias,
			this._contextWindowFallbacks,
			this._contentPolicyFallbacks,
		);

		this._routeFn = this._selectStrategy(config.routing_strategy);
	}

	/** 返回 Router 持有的 deployments 列表的拷贝 */
	getDeployments(): Deployment[] {
		return [...this._deployments];
	}

	private _selectStrategy(name: string): RouteFn {
		const fn = STRATEGY_MAP[name];
		if (fn) {
			return fn;
		}
		throw new Error(`Unknown routing strategy: "${name}". Valid strategies: ${Object.keys(STRATEGY_MAP).join(", ")}`);
	}

	private _estimateInputTokens(messages: Message[]): number {
		const inputTextLength = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
		return Math.ceil(inputTextLength / CHARS_PER_TOKEN) + ESTIMATED_TOKENS_OVERHEAD;
	}

	private _buildRoutingContext(deployments: Deployment[], estimatedInputTokens?: number): RoutingContext {
		return {
			deployments: deployments,
			tpmRpmLimiter: {
				getUsage: (name: string) => this._tpmRpmLimiter.getUsage(name),
				tryReserveSync: (name: string, tpmLimit?: number, rpmLimit?: number, estimatedInputTokens?: number): boolean =>
					this._tpmRpmLimiter.tryReserveSync(name, tpmLimit, rpmLimit, estimatedInputTokens),
				rollbackReservation: (name: string): boolean => this._tpmRpmLimiter.rollbackReservation(name),
			},
			activeRequests: this._activeRequests,
			latencies: this._latencies,
			estimatedInputTokens: estimatedInputTokens,
			ttft: this._ttft,
			modelCostMap: this._modelCostMap,
		};
	}

	private _getDeploymentsForModel(model: string): Deployment[] {
		const resolved = this._fallbackHandler.resolveModelGroup(model);
		return this._deployments.filter(
			(dep) => this._matchDeploymentPattern(dep, resolved) && !this._cooldownManager.isInCooldown(getDeploymentKey(dep)),
		);
	}

	private _matchDeploymentPattern(dep: Deployment, model: string): boolean {
		if (dep.model_name === model) {
			return true;
		}
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			const stripped = model.slice(slashIdx + 1);
			if (dep.model_name === stripped) {
				return true;
			}
			if (dep.model_name.includes("*")) {
				const prefix = dep.model_name.replace(/\*/g, "");
				if (stripped.startsWith(prefix) || model.startsWith(prefix)) {
					return true;
				}
			}
		}
		if (dep.model_name.includes("*")) {
			const prefix = dep.model_name.replace(/\*/g, "");
			if (model.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}

	private _getHealthyDeploymentsForGroup(model: string): Deployment[] {
		return this._deployments.filter((d) => d.model_name === model && !this._cooldownManager.isInCooldown(getDeploymentKey(d)));
	}

	/**
	 * 选取一个可用 deployment 并附上其 provider 配置。messages 可选用于 token 估算
	 * @param model - 逻辑模型名（用户传入）
	 * @param messages - 可选消息列表（用于 token 估算）
	 */
	getAvailableDeployment(model: string, messages?: Message[]): AvailDeployment | null {
		const deployments = this._getDeploymentsForModel(model);
		if (deployments.length === 0) {
			return null;
		}
		const estimatedInputTokens = messages ? this._estimateInputTokens(messages) : undefined;
		const ctx = this._buildRoutingContext(deployments, estimatedInputTokens);
		const selected = this._routeFn(deployments, ctx);
		if (!selected) {
			return null;
		}
		const provider = this._providerRegistry.getProvider(selected.litellm_params.model, selected.litellm_params.custom_llm_provider);
		return { deployment: selected, provider: provider };
	}

	private async _executeRequest(
		provider: ProviderConfigType,
		deployment: Deployment,
		messages: Message[],
		optionalParams: Record<string, unknown>,
	): Promise<ExecResult> {
		const mergedParams: Record<string, unknown> = { ...deployment.litellm_params, ...optionalParams };
		const providerRequest = provider.transformRequest(deployment.litellm_params.model, messages as Message[], mergedParams);

		const isStream = optionalParams["stream"] === true;
		const timeoutSec = isStream
			? (deployment.litellm_params.stream_timeout ?? deployment.litellm_params.timeout)
			: deployment.litellm_params.timeout;
		const abortController = new AbortController();
		const timeoutHandle = timeoutSec !== undefined ? setTimeout(() => abortController.abort(), timeoutSec * 1000) : undefined;
		const fetchStart = Date.now();

		try {
			const response = await fetch(providerRequest.url, {
				method: providerRequest.method,
				headers: providerRequest.headers,
				body: JSON.stringify(providerRequest.body),
				signal: abortController.signal,
			});

			if (isStream) {
				const { stream, body, ttft } = buildStreamWithTtft(response, fetchStart, provider);
				const providerHeaders = extractProviderHeaders(response);
				if (providerHeaders) {
					(response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders = providerHeaders;
				}
				return { response: response, body: body, ttft: ttft, stream: stream };
			}

			const body = await response.json();
			const ttft = Date.now() - fetchStart;
			const providerHeaders = extractProviderHeaders(response);
			if (providerHeaders) {
				(response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders = providerHeaders;
			}
			return { response: response, body: body, ttft: ttft };
		} finally {
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	private _buildExecContext(): RouterExecContext {
		return {
			deployments: this._deployments,
			cooldownManager: this._cooldownManager,
			tpmRpmLimiter: this._tpmRpmLimiter,
			fallbackHandler: this._fallbackHandler,
			providerRegistry: this._providerRegistry,
			activeRequests: this._activeRequests,
			latencies: this._latencies,
			latencySamples: this._latencySamples,
			ttft: this._ttft,
			totalCalls: this._totalCalls,
			successCalls: this._successCalls,
			failCalls: this._failCalls,
			routerCallbacks: this._routerCallbacks,
			retryPolicy: this._retryPolicy,
			modelGroupRetryPolicy: this._modelGroupRetryPolicy,
			numRetries: this._numRetries,
			maxFallbacks: this._maxFallbacks,
			preCallChecks: this._preCallChecks,
			optionalPreCallChecks: this._optionalPreCallChecks,
			retryAfter: this._retryAfter,
			cooldownTimeMs: this._cooldownTimeMs,
			recentLatencyCount: RECENT_LATENCY_COUNT,
			failureLatencyPenaltySec: FAILURE_LATENCY_PENALTY_SEC,
		};
	}

	private _executeWithFallback(
		model: string,
		messages: Message[],
		optionalParams: Record<string, unknown>,
		fallbackDepth: number,
		previousError?: Error,
	): Promise<Record<string, unknown>> {
		const ctx = this._buildExecContext();
		return executeWithFallback(
			ctx,
			{
				model: model,
				messages: messages,
				optionalParams: optionalParams,
				fallbackDepth: fallbackDepth,
				previousError: previousError,
			},
			{
				getCandidate: (m, msgs) => this.getAvailableDeployment(m, msgs),
				estimateInputTokens: (msgs) => this._estimateInputTokens(msgs),
				executeRequest: (prov, dep, msgs, params) => this._executeRequest(prov, dep, msgs, params),
				matchDeploymentPattern: (dep, m) => this._matchDeploymentPattern(dep, m),
				getHealthyDeployments: (m) => this._getHealthyDeploymentsForGroup(m),
			},
		);
	}

	/**
	 * PY: completion(model, messages, **kwargs) 透传 kwargs
	 * @param model - 逻辑模型名
	 * @param messages - 消息列表
	 * @param optionalParams - 请求参数（含 stream/temperature/fallbacks/mock_testing_*）
	 */
	async completion(model: string, messages: Message[], optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		optionalParams = normalizeMockTestingParams(optionalParams);
		if (Array.isArray(optionalParams["fallbacks"])) {
			const seen = new Set<string>();
			optionalParams["fallbacks"] = (optionalParams["fallbacks"] as string[]).filter((fb) => {
				if (seen.has(fb)) {
					return false;
				}
				seen.add(fb);
				return true;
			});
		}
		const rateLimitDispatch = shouldDispatchMockRateLimit(optionalParams, model);
		if (rateLimitDispatch.dispatch) {
			throw rateLimitDispatch.error;
		}
		const retryAttempt = optionalParams["retry"];
		if (typeof retryAttempt === "number" && retryAttempt > 0) {
			let previousForModel = this._previousModels.get(model);
			if (!previousForModel) {
				previousForModel = [];
				this._previousModels.set(model, previousForModel);
			}
			previousForModel.push(retryAttempt);
			logger.debug(`Retrying request with num_retries: ${retryAttempt}`);
		}
		const silentModel = optionalParams["silent_model"];
		if (typeof silentModel === "string" && silentModel.length > 0) {
			const realResult = await this._executeWithFallback(model, messages, optionalParams, 0);
			this._executeWithFallback(silentModel, messages, { ...optionalParams, isSilentCall: true }, 0).catch(() => {
				// silent_model 失败仅记录，不抛
			});
			return realResult;
		}
		return this._executeWithFallback(model, messages, optionalParams, 0);
	}

	/**
	 * 同步 completion 已移除（饿死事件循环风险）。调用方请改用 `await router.completion(...)`。
	 * @param _model - 保留参数签名兼容
	 * @param _messages - 保留参数签名兼容
	 * @param _optionalParams - 保留参数签名兼容
	 * @param _timeoutMs - 保留参数签名兼容，缺省 DEFAULT_COMPLETION_SYNC_TIMEOUT_MS
	 * @throws {RouterCompletionSyncRemovedError} 总是抛出
	 */
	completionSync(
		_model: string,
		_messages: Message[],
		_optionalParams: Record<string, unknown> = {},
		_timeoutMs = DEFAULT_COMPLETION_SYNC_TIMEOUT_MS,
	): Record<string, unknown> {
		throw new RouterCompletionSyncRemovedError(
			"Router.completionSync 已移除（饿死事件循环风险）。请改用 `await router.completion(model, messages, params)` 异步调用。",
		);
	}

	/**
	 * 异步入口：mock_testing_* 钩子分发（与 completion 等价，但显式处理异步异常）
	 * @param model - 逻辑模型名
	 * @param messages - 消息列表
	 * @param optionalParams - 请求参数
	 */
	async acompletion(model: string, messages: Message[], optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		optionalParams = normalizeMockTestingParams(optionalParams);
		try {
			tryDispatchMockTestingExceptions(optionalParams, model, this._fallbackHandler);
		} catch (mockErr) {
			return this._executeWithFallback(model, messages, optionalParams, 0, mockErr as Error);
		}
		return this.completion(model, messages, optionalParams);
	}

	/**
	 * 把 deployment 标记为冷却（供 test/外部调用）
	 * @param modelName - deployment model_name
	 */
	markFailed(modelName: string): void {
		this._cooldownManager.markFailed(modelName, this._cooldownTimeMs);
	}

	/**
	 * 获取第 fallbackDepth 个 fallback model 名
	 * @param model - 原始模型名
	 * @param fallbackDepth - 回退深度
	 */
	getNextFallback(model: string, fallbackDepth: number): string | null {
		return this._fallbackHandler.getNextFallback(model, fallbackDepth);
	}

	/**
	 * 增减某 deployment 的活跃请求计数（外部/test 观察）
	 * @param modelName - deployment model_name
	 * @param delta - 增量（正/负）
	 */
	trackActiveRequest(modelName: string, delta: number): void {
		const current = this._activeRequests.get(modelName) ?? 0;
		this._activeRequests.set(modelName, Math.max(0, current + delta));
	}
}
