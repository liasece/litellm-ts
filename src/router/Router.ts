/**
 * LiteLLM Router
 *
 * Central orchestrator for model routing with:
 * - Cooldown tracking for failed deployments
 * - TPM/RPM rate limiting
 * - Configurable routing strategies
 * - Fallback chain support
 * - Model group alias resolution
 */

import type { Deployment, RetryPolicy, RouterConfig, RouterModelGroupAliasItem } from "../types/router";
import type { ProviderConfig } from "../types/provider";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { CooldownManager } from "./CooldownManager";
import { TPMRPMLimiter } from "./TPMRPMLimiter";
import { FallbackHandler } from "./FallbackHandler";
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
import { ContextWindowExceededError, ContentPolicyViolationError, APIConnectionError, RateLimitError } from "./RouterErrors";

type RouteFn = (deployments: Deployment[], ctx: RoutingContext) => Deployment | null;

interface Message {
	role: string;
	content: string | null;
}

interface ExecResult {
	response: Response;
	body: unknown;
	ttft: number;
}

interface AvailDeployment {
	deployment: Deployment;
	provider: ProviderConfig;
}

const STRATEGY_MAP: Record<string, RouteFn> = {
	"simple-shuffle": simpleShuffle,
	"least-busy": leastBusy,
	"usage-based-routing": usageBasedRouting,
	"latency-based-routing": latencyBasedRouting,
	"cost-based-routing": costBasedRouting,
	"usage-based-routing-v2": usageBasedRoutingV2,
};

/**
 *
 */
export class Router {
	private _deployments: Deployment[];
	private _cooldownManager: CooldownManager;
	private _tpmRpmLimiter: TPMRPMLimiter;
	private _fallbackHandler: FallbackHandler;
	private _providerRegistry: ProviderRegistry;
	private _routeFn: RouteFn;
	private _cooldownTimeMs: number;
	private _numRetries: number;
	private _modelGroupAlias: Record<string, string | RouterModelGroupAliasItem>;
	private _disableCooldowns: boolean;
	private _contextWindowFallbacks: Record<string, string[]>;
	private _contentPolicyFallbacks: Record<string, string[]>;
	private _retryPolicy?: RetryPolicy;
	private _modelGroupRetryPolicy?: Record<string, RetryPolicy>;
	private _maxFallbacks: number;
	private _preCallChecks: boolean;
	/** 可选预检配置，对齐 PY optional_pre_call_checks */
	private _optionalPreCallChecks: Record<string, boolean> | undefined;
	/** retry_after（min_timeout），退避计算时作为基数下限 */
	private _retryAfter: number;
	/** 全局模型成本映射表，对齐 PY litellm.model_cost */
	private _modelCostMap: Record<string, { input_cost_per_token: number; output_cost_per_token: number }> | undefined;

	/**
	 *
	 */
	getDeployments(): Deployment[] {
		return [...this._deployments];
	}

	private _activeRequests: Map<string, number> = new Map();
	private _latencies: Map<string, number> = new Map();
	/** PY: TTFT (time to first token) per deployment key (ms), used by latencyBasedRouting for streaming */
	private _ttft: Map<string, number> = new Map();
	/** PY: rolling window mean latency samples, use recent N values (GAP #13) */
	private _latencySamples: Map<string, number[]> = new Map();
	private static readonly _recentLatencyCount = 10;
	/** PY INITIAL_RETRY_DELAY=0.5s */
	private static readonly _initialRetryDelayMs = 500;

	constructor(config: RouterConfig, modelGroupAlias?: Record<string, string | RouterModelGroupAliasItem>) {
		this._deployments = [...config.model_list];
		this._cooldownTimeMs = (config.cooldown_time ?? 5) * 1000;
		// PY: config.num_retries ?? litellm.num_retries ?? openai.DEFAULT_MAX_RETRIES (DEFAULT_MAX_RETRIES=2)
		this._numRetries = config.num_retries ?? 2;
		this._modelGroupAlias = modelGroupAlias ?? {};
		this._disableCooldowns = config.disable_cooldowns ?? false;
		this._contextWindowFallbacks = config.context_window_fallbacks ?? {};
		this._contentPolicyFallbacks = config.content_policy_fallbacks ?? {};
		this._retryPolicy = config.retry_policy;
		this._modelGroupRetryPolicy = config.model_group_retry_policy;
		this._maxFallbacks = config.max_fallbacks ?? 5;
		this._preCallChecks = config.pre_call_checks ?? false;
		this._optionalPreCallChecks = config.optional_pre_call_checks;
		this._retryAfter = config.retry_after ?? 0;
		this._modelCostMap = config.model_cost_map;

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
		);
		this._tpmRpmLimiter = new TPMRPMLimiter();
		this._providerRegistry = new ProviderRegistry();

		const mergedFallbacks: Record<string, string[]> = {};
		// PY: first-match wins (keep existing key, skip on subsequent writes).
		// PY fallbacks is List[Dict], iterates in order, only sets if key not yet present.
		for (const fb of config.fallbacks ?? []) {
			for (const [key, vals] of Object.entries(fb)) {
				if (!(key in mergedFallbacks)) {
					mergedFallbacks[key] = vals;
				}
			}
		}
		// PY default_fallbacks: 自动添加到 fallbacks 的通配符 * 条目
		if (config.default_fallbacks && config.default_fallbacks.length > 0 && !mergedFallbacks["*"]) {
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

	private _selectStrategy(name: string): RouteFn {
		const fn = STRATEGY_MAP[name];
		if (fn) {
			return fn;
		}
		return simpleShuffle;
	}

	private _estimateInputTokens(messages: Message[]): number {
		const inputTextLength = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
		return Math.ceil(inputTextLength / 3.5) + 10;
	}

	private _buildRoutingContext(deployments: Deployment[], estimatedInputTokens?: number): RoutingContext {
		return {
			deployments: deployments,
			tpmRpmLimiter: {
				getUsage: (name: string) => this._tpmRpmLimiter.getUsage(name),
			},
			activeRequests: this._activeRequests,
			latencies: this._latencies,
			estimatedInputTokens: estimatedInputTokens,
			ttft: this._ttft,
			modelCostMap: this._modelCostMap,
		};
	}

	private _getDeploymentsForModel(model: string): Deployment[] {
		return this._deployments.filter(
			(dep) => dep.model_name === model && !this._cooldownManager.isInCooldown(this._getDeploymentKey(dep)),
		);
	}

	/**
	 * @param model
	 * @param messages - optional messages for input token estimation
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

	/**
	 * 计算同模型组的部署实例数
	 * @param deployment
	 */
	private _countSameGroupDeployments(deployment: Deployment): number {
		return this._deployments.filter((d) => d.model_name === deployment.model_name).length;
	}

	private async _executeRequest(
		provider: ProviderConfig,
		deployment: Deployment,
		messages: Message[],
		optionalParams: Record<string, unknown>,
	): Promise<ExecResult> {
		const mergedParams: Record<string, unknown> = {
			...deployment.litellm_params,
			...optionalParams,
		};

		const providerRequest = provider.transformRequest(deployment.litellm_params.model, messages as Message[], mergedParams);

		const fetchStart = Date.now();
		const response = await fetch(providerRequest.url, {
			method: providerRequest.method,
			headers: providerRequest.headers,
			body: JSON.stringify(providerRequest.body),
		});

		const body = await response.json();
		const ttft = Date.now() - fetchStart;
		return { response: response, body: body, ttft: ttft };
	}

	/** 检查非标准 fallback 格式，对齐 PY _check_non_standard_fallback_format */

	private _checkNonStandardFallbackFormat(fallback: unknown): string[] | null {
		if (Array.isArray(fallback)) {
			if (fallback.every((f) => typeof f === "string")) {
				return fallback as string[];
			}
			return null;
		}
		if (typeof fallback === "string") {
			return [fallback];
		}
		return null;
	}

	/**
	 * 检查 200 响应中是否包含 content_filter finish_reason，触发内容策略回退 (GAP #11)
	 * @param body - 上游响应 body
	 * @param model - 当前模型名
	 * @param modelName - 部署模型名（用于日志）
	 * @throws {ContentPolicyViolationError} 当检测到 content_filter 时抛出
	 */
	private _checkContentFilterOn200Response(body: unknown, model: string, modelName: string): void {
		const cpFallbackChain = this._fallbackHandler.getContentPolicyFallbackChain(model);
		if (cpFallbackChain.length === 0) {
			return;
		}
		const bodyRecord = body as Record<string, unknown>;
		const choices = bodyRecord?.choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			return;
		}
		const firstChoice = choices[0] as Record<string, unknown> | undefined;
		if (firstChoice?.finish_reason === "content_filter") {
			const cpFallback = cpFallbackChain[0];
			if (cpFallback) {
				logger.warn(`Content filter detected in 200 response on ${modelName}, trying CP fallback`);
				throw new ContentPolicyViolationError("Content filter triggered on 200 response");
			}
		}
	}

	/**
	 * 根据错误类型从 retry_policy / model_group_retry_policy 获取覆写的重试次数
	 * @param model
	 * @param error
	 * @param overridePolicy - per-request policy override (PY router.py:5560-5563)
	 */
	private _getRetryPolicyOverride(model: string, error: Error, overridePolicy?: Record<string, RetryPolicy>): number | undefined {
		const policy = overridePolicy?.[model] ?? this._modelGroupRetryPolicy?.[model] ?? this._retryPolicy;
		if (!policy) {
			return undefined;
		}

		if (error instanceof RateLimitError) {
			return policy.RateLimitErrorRetries ?? undefined;
		}
		// PY: ContentPolicyViolationError retries from retry_policy
		if (error instanceof ContentPolicyViolationError) {
			return policy.ContentPolicyViolationErrorRetries ?? undefined;
		}
		if (error instanceof ContextWindowExceededError) {
			return undefined;
		}
		if (error instanceof APIConnectionError || error.message.includes("Timeout")) {
			return policy.TimeoutErrorRetries ?? undefined;
		}
		if (error.message.includes("400") || error.message.includes("bad_request")) {
			return policy.BadRequestErrorRetries ?? undefined;
		}
		if (error.message.includes("401") || error.message.includes("403") || error.message.includes("Authentication")) {
			return policy.AuthenticationErrorRetries ?? undefined;
		}
		if (/5\d{2}/.exec(error.message) || error.message.includes("Internal Server Error") || error.message.includes("server_error")) {
			return policy.InternalServerErrorRetries ?? undefined;
		}
		return undefined;
	}

	/**
	 * 将 error 映射为 errorCategory 字符串，用于 CooldownManager 的类型分发
	 * @param error
	 */
	private _categorizeErrorForCooldown(error: Error): string {
		if (error instanceof RateLimitError || error.message.includes("429") || error.message.includes("rate_limit")) {
			return "RateLimitError";
		}
		if (error instanceof ContentPolicyViolationError) {
			return "ContentPolicyViolationError";
		}
		if (error instanceof ContextWindowExceededError) {
			return "BadRequestError";
		}
		if (error instanceof APIConnectionError || error.message.includes("Timeout")) {
			return "TimeoutError";
		}
		if (error.message.includes("401") || error.message.includes("403") || error.message.includes("Authentication")) {
			return "AuthenticationError";
		}
		if (error.message.includes("400") || error.message.includes("bad_request")) {
			return "BadRequestError";
		}
		if (/5\d{2}/.exec(error.message) || error.message.includes("Internal Server Error") || error.message.includes("server_error")) {
			return "InternalServerError";
		}
		return "BadRequestError";
	}

	private async _executeWithFallback(
		model: string,
		messages: Message[],
		optionalParams: Record<string, unknown>,
		fallbackDepth: number,
	): Promise<Record<string, unknown>> {
		if (fallbackDepth >= this._maxFallbacks) {
			throw new Error(`Max fallback depth (${this._maxFallbacks}) reached for model "${model}"`);
		}

		const alias = this._modelGroupAlias[model];
		// PY: per-request model_group_retry_policy from optionalParams (router.py:5560-5563)
		const perRequestRetryPolicy = optionalParams["model_group_retry_policy"] as Record<string, RetryPolicy> | undefined;
		const effectiveRetryPolicyOverride: Record<string, RetryPolicy> | undefined = (() => {
			if (!perRequestRetryPolicy) {
				return this._modelGroupRetryPolicy;
			}
			if (!this._modelGroupRetryPolicy) {
				return perRequestRetryPolicy;
			}
			const merged = { ...this._modelGroupRetryPolicy };
			for (const [k, v] of Object.entries(perRequestRetryPolicy)) {
				merged[k] = v;
			}
			return merged;
		})();
		const resolvedModel =
			typeof alias === "string" ? alias : alias && typeof alias === "object" && "model" in alias ? alias.model : model;
		const candidate = this.getAvailableDeployment(resolvedModel, messages);

		if (!candidate) {
			const nextFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
			if (nextFallback) {
				return this._executeWithFallback(nextFallback, messages, optionalParams, fallbackDepth + 1);
			}
			throw new Error(`No available deployment for model "${model}" and no fallbacks remaining`);
		}

		const { deployment: initialDeployment, provider: initialProvider } = candidate;
		let deployment = initialDeployment;
		let provider = initialProvider;

		if (this._preCallChecks) {
			// PY enable_pre_call_checks: bool 控制 context window 过滤；
			// optional_pre_call_checks: List 支持扩展检查（router_budget_limiting等）
			if (!this._optionalPreCallChecks || this._optionalPreCallChecks["deployment_affinity"] !== false) {
				// Check context window limits (aligns with PY pre_call_checks which checks context window, not TPM/RPM)
				const maxInputTokens = deployment.model_info?.max_input_tokens;
				if (maxInputTokens !== undefined) {
					const inputTextLength = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
					const estimatedTokens = Math.ceil(inputTextLength / 3.5) + 10;
					const maxOutputTokens = (optionalParams.max_tokens as number) ?? 4096;
					if (estimatedTokens + maxOutputTokens > maxInputTokens) {
						const otherDeployments = this._deployments.filter(
							(d) => d.model_name === deployment.model_name && !this._cooldownManager.isInCooldown(this._getDeploymentKey(d)),
						);
						for (const other of otherDeployments) {
							const otherMaxInput = other.model_info?.max_input_tokens;
							if (otherMaxInput !== undefined && estimatedTokens + maxOutputTokens <= otherMaxInput) {
								return this._executeWithFallback(other.model_name, messages, optionalParams, fallbackDepth + 1);
							}
						}
						logger.warn(
							`Context window warning on ${deployment.model_name}: estimated ${estimatedTokens}+${maxOutputTokens} > ${maxInputTokens}, proceeding anyway`,
						);
					}
				}
			}
			// GAP #12: PY also checks RPM/TPM limit in pre_call_checks (RPM, 区域过滤, 无效参数, 响应格式)
			if (!this._optionalPreCallChecks || this._optionalPreCallChecks["model_rate_limit"] !== false) {
				const rpmLimit = deployment.litellm_params.rpm;
				const tpmLimit = deployment.litellm_params.tpm;
				if (rpmLimit !== undefined || tpmLimit !== undefined) {
					const usage = this._tpmRpmLimiter.getUsage(this._getDeploymentKey(deployment));
					// PY: 仅记录警告, 不触发回退 -- PY 在 _acompletion 中通过 routing_strategy_pre_call_checks 处理
					if (rpmLimit !== undefined && usage.rpm >= rpmLimit) {
						logger.warn(`RPM limit reached on ${deployment.model_name} (${usage.rpm} >= ${rpmLimit})`);
					}
					if (tpmLimit !== undefined && usage.tpm >= tpmLimit) {
						logger.warn(`TPM limit reached on ${deployment.model_name} (${usage.tpm} >= ${tpmLimit})`);
					}
				}
			}
		}

		const depKey = this._getDeploymentKey(deployment);
		const currentActive = this._activeRequests.get(depKey) ?? 0;
		this._activeRequests.set(depKey, currentActive + 1);

		const startTime = Date.now();
		let retryAfterHeader: string | undefined;

		try {
			let lastError: Error | null = null;
			let deploymentRetries = deployment.litellm_params.num_retries ?? this._numRetries;
			let maxRetries = deploymentRetries > 0 ? deploymentRetries : 0;

			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				// PY: re-select deployment on each retry to allow routing to healthy alternative (GAP #4)
				if (attempt > 0) {
					const reCandidate = this.getAvailableDeployment(resolvedModel, messages);
					if (reCandidate) {
						provider = reCandidate.provider;
						deployment = reCandidate.deployment;
						// GAP #4+5: re-read num_retries from newly selected deployment — PY reads on each retry iteration
						deploymentRetries = deployment.litellm_params.num_retries ?? this._numRetries;
						maxRetries = deploymentRetries > 0 ? deploymentRetries : 0;
					}
				}
				try {
					const { response, body } = await this._executeRequest(provider, deployment, messages, optionalParams);
					const elapsed = Date.now() - startTime;
					// PY: record latency per deployment (model_info.id) not per model_name
					const depLatKey = this._getDeploymentKey(deployment);
					const samples = this._latencySamples.get(depLatKey) ?? [];
					samples.push(elapsed);
					if (samples.length > Router._recentLatencyCount) {
						samples.shift();
					}
					this._latencySamples.set(depLatKey, samples);
					const avgLatency = samples.reduce((a, b) => a + b, 0) / samples.length;
					this._latencies.set(depLatKey, avgLatency);

					if (!response.ok) {
						const bodyStr = JSON.stringify(body);
						lastError = new Error(`Provider returned ${response.status}: ${bodyStr}`);

						const categorizedError = this._categorizeProviderError(response.status, bodyStr);
						retryAfterHeader = this._extractRetryAfterFromResponse(response);

						if (categorizedError instanceof ContextWindowExceededError) {
							const cwFallback = this._fallbackHandler.getContextWindowFallbackChain(model);
							if (cwFallback.length > 0) {
								logger.warn(`Context window error on ${deployment.model_name}, trying context window fallback`);
								return this._executeWithFallback(cwFallback[0]!, messages, optionalParams, fallbackDepth + 1);
							}
							const generalFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
							if (generalFallback) {
								return this._executeWithFallback(generalFallback, messages, optionalParams, fallbackDepth + 1);
							}
						}

						if (categorizedError instanceof ContentPolicyViolationError) {
							const cpFallback = this._fallbackHandler.getContentPolicyFallbackChain(model);
							if (cpFallback.length > 0) {
								logger.warn(`Content policy error on ${deployment.model_name}, trying content policy fallback`);
								return this._executeWithFallback(cpFallback[0]!, messages, optionalParams, fallbackDepth + 1);
							}
							const generalFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
							if (generalFallback) {
								return this._executeWithFallback(generalFallback, messages, optionalParams, fallbackDepth + 1);
							}
						}

						// PY: retry_policy_applies -> skip should_retry_this_error (PY:5631-5643)
						const retryPolicyOverride = this._getRetryPolicyOverride(model, categorizedError, effectiveRetryPolicyOverride);
						if (
							retryPolicyOverride === undefined &&
							!this._shouldRetryThisError(response.status, deployment.model_name, categorizedError)
						) {
							break;
						}

						const responseEffectiveMaxRetries = retryPolicyOverride !== undefined ? retryPolicyOverride : maxRetries;
						if (attempt < responseEffectiveMaxRetries) {
							const sleepSec = this._timeToSleepBeforeRetry(deployment.model_name, attempt, retryAfterHeader);
							if (sleepSec === 0) {
								// PY: zero backoff -> continue retry loop, next routing picks fresh deployment
								continue;
							} else {
								await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
							}
						}
						continue;
					}

					// GAP #11: PY checks 200 responses for content_filter finish_reason
					this._checkContentFilterOn200Response(body, model, deployment.model_name);

					this._cooldownManager.clearCooldown(depKey);
					this._cooldownManager.recordSuccess(depKey);
					this._tpmRpmLimiter.incrementRequest(this._getDeploymentKey(deployment));

					try {
						const usage = (body as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
						if (usage && (usage["total_tokens"] as number)) {
							this._tpmRpmLimiter.incrementTokens(this._getDeploymentKey(deployment), usage["total_tokens"] as number);
						}
					} catch {
						// Token tracking is best-effort
					}

					const transformed = provider.transformResponse(deployment.litellm_params.model, body);

					return {
						...transformed,
						_provider: deployment.model_name,
						_fallbackDepth: fallbackDepth,
					};
				} catch (err) {
					lastError = err instanceof Error ? err : new Error(String(err));

					// PY: retry loop catch 中重新检查 context_window_fallbacks / content_policy_fallbacks 并触发回退
					if (lastError instanceof ContextWindowExceededError) {
						const cwFallback = this._fallbackHandler.getContextWindowFallbackChain(model);
						if (cwFallback.length > 0) {
							logger.warn(`Context window error on ${deployment.model_name} (catch), trying context window fallback`);
							return this._executeWithFallback(cwFallback[0]!, messages, optionalParams, fallbackDepth + 1);
						}
						const generalFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
						if (generalFallback) {
							return this._executeWithFallback(generalFallback, messages, optionalParams, fallbackDepth + 1);
						}
					}
					if (lastError instanceof ContentPolicyViolationError) {
						const cpFallback = this._fallbackHandler.getContentPolicyFallbackChain(model);
						if (cpFallback.length > 0) {
							logger.warn(`Content policy error on ${deployment.model_name} (catch), trying content policy fallback`);
							return this._executeWithFallback(cpFallback[0]!, messages, optionalParams, fallbackDepth + 1);
						}
						const generalFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
						if (generalFallback) {
							return this._executeWithFallback(generalFallback, messages, optionalParams, fallbackDepth + 1);
						}
					}

					const policyOverride = this._getRetryPolicyOverride(model, lastError, effectiveRetryPolicyOverride);
					const effectiveMaxRetries = policyOverride !== undefined ? policyOverride : maxRetries;

					if (attempt >= effectiveMaxRetries) {
						throw lastError;
					}

					// PY: always re-extract Retry-After on each error (GAP #3)
					retryAfterHeader = this._extractRetryAfterFromError(lastError);
					if (attempt < maxRetries) {
						const sleepSec = this._timeToSleepBeforeRetry(deployment.model_name, attempt, retryAfterHeader);
						if (sleepSec === 0) {
							// PY: zero backoff -> retry by setting the loop to max so we fall through outer catch
							continue;
						}
						await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
					}
				}
			}

			throw lastError ?? new Error("Unknown error during completion");
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));

			const statusCode = error.message ? parseInt(/\d{3}/.exec(error.message)?.[0] ?? "500", 10) : 500;
			const sameGroupCount = this._countSameGroupDeployments(deployment);
			const errorCategory = this._categorizeErrorForCooldown(error);

			if (this._cooldownManager.isCooldownRequired(depKey, statusCode, error.message, sameGroupCount, errorCategory)) {
				const deployCooldown = deployment.litellm_params.cooldown_time ? deployment.litellm_params.cooldown_time * 1000 : undefined;
				// PY: prefer the Retry-After value already set from response headers (line 461),
				// fall back to extracting from the error object (GAP #3 MISSING).
				const effectiveRetryAfter = retryAfterHeader ?? this._extractRetryAfterFromError(error);
				const retryAfterMs = effectiveRetryAfter ? (this._parseRetryAfterSeconds(effectiveRetryAfter) ?? 0) : 0;
				const retryCooldown = retryAfterMs > 0 ? retryAfterMs * 1000 : undefined;
				const cooldownDuration = deployCooldown ?? retryCooldown ?? this._cooldownTimeMs;
				this._cooldownManager.markFailed(depKey, cooldownDuration);
				this._cooldownManager.recordFailure(depKey);
			}

			const nextFallback = this._fallbackHandler.getNextFallback(model, fallbackDepth);
			if (nextFallback) {
				return this._executeWithFallback(nextFallback, messages, optionalParams, fallbackDepth + 1);
			}

			throw err;
		} finally {
			const active = this._activeRequests.get(depKey) ?? 1;
			this._activeRequests.set(depKey, Math.max(0, active - 1));
		}
	}

	/**
	 * 对齐 PY isinstance 检查，比纯字符串匹配更健壮
	 * @param statusCode
	 * @param bodyStr
	 */
	private _categorizeProviderError(statusCode: number, bodyStr: string): Error {
		const lower = bodyStr.toLowerCase();

		if (
			lower.includes("context_length_exceeded") ||
			lower.includes("maximum context length") ||
			lower.includes("too many tokens") ||
			lower.includes("max tokens") ||
			lower.includes("context window") ||
			lower.includes("token limit")
		) {
			return new ContextWindowExceededError(bodyStr);
		}

		if (
			lower.includes("content_policy") ||
			lower.includes("content_filter") ||
			lower.includes("content moderation") ||
			lower.includes("safety") ||
			lower.includes("harmful") ||
			lower.includes("inappropriate")
		) {
			return new ContentPolicyViolationError(bodyStr);
		}

		if (statusCode === 429 || lower.includes("rate limit") || lower.includes("rate_limit")) {
			return new RateLimitError(bodyStr);
		}

		return new Error(bodyStr);
	}

	private _extractRetryAfterFromResponse(response: Response): string | undefined {
		return response.headers?.get("Retry-After") ?? undefined;
	}

	private _extractRetryAfterFromError(error: Error): string | undefined {
		const match = /Retry-After:\s*(\d+)/i.exec(error.message);
		if (match?.[1]) {
			return match[1];
		}
		// PY: check error.response_headers / error.litellm_response_headers (httpx Headers)
		const errWithHeaders = error as unknown as Record<string, Record<string, string>>;
		if (errWithHeaders["response_headers"]?.["Retry-After"]) {
			return errWithHeaders["response_headers"]["Retry-After"];
		}
		if (errWithHeaders["litellm_response_headers"]?.["Retry-After"]) {
			return errWithHeaders["litellm_response_headers"]["Retry-After"];
		}
		const errWithRetryAfter = error as unknown as Record<string, unknown>;
		if (typeof errWithRetryAfter["retry_after"] === "number") {
			return String(errWithRetryAfter["retry_after"]);
		}
		return undefined;
	}

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	async completion(model: string, messages: Message[], optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		return this._executeWithFallback(model, messages, optionalParams, 0);
	}

	/**
	 * 简单状态码重试判断（同部署内使用）
	 * @param statusCode
	 */
	private _shouldRetry(statusCode: number): boolean {
		if (statusCode === 408 || statusCode === 409 || statusCode === 429) {
			return true;
		}
		return statusCode >= 500;
	}

	/**
	 * 对齐 PY should_retry_this_error。检查该错误是否应触发（可跨部署）重试。
	 * 401/403：多部署可重试，无 fallback 时立即抛出
	 * ContextWindowExceededError/ContentPolicyViolationError/NotFoundError：
	 *   直接 raise，不重试
	 * 检查 num_all_deployments（全体部署数）而非仅同组健康数（PY 方式）
	 * @param statusCode
	 * @param model - 模型名（用于计算同组部署数）
	 * @param categorizedError - 可选，PY isinstance 检查用
	 */
	private _shouldRetryThisError(statusCode: number, model: string, categorizedError?: Error): boolean {
		// PY: generic check for all error types — if no healthy deployments, don't retry (GAP #3)
		if (this._getDeploymentsForModel(model).length === 0) {
			return false;
		}
		// PY: isinstance 检查 — 这些错误不重试，直接 raise
		if (categorizedError instanceof ContextWindowExceededError) {
			const cwFallback = this._fallbackHandler.getContextWindowFallbackChain(model);
			if (cwFallback.length > 0) {
				return false; // PY: 有 CW fallback 时不重试，让 fallback 层处理 (router.py:5824-5834)
			}
			return true; // PY: 无 CW fallback 时继续重试
		}
		if (categorizedError instanceof ContentPolicyViolationError) {
			const cpFallback = this._fallbackHandler.getContentPolicyFallbackChain(model);
			if (cpFallback.length > 0) {
				return false; // PY: 有 CP fallback 时不重试，让 fallback 层处理 (router.py:5824-5834)
			}
			return true; // PY: 无 CP fallback 时继续重试
		}
		// NotFoundError: 404 不重试同一部署（PY 直接 raise）
		if (statusCode === 404) {
			return false;
		}
		if (statusCode === 429) {
			// PY: 无健康部署且有 fallback 时放弃重试，让 fallback 层处理 (router.py:5845-5851)
			if (this._getDeploymentsForModel(model).length === 0) {
				const hasFallbacks =
					this._fallbackHandler.getFallbackChain(model).length > 0 ||
					this._fallbackHandler.getContextWindowFallbackChain(model).length > 0 ||
					this._fallbackHandler.getContentPolicyFallbackChain(model).length > 0;
				if (hasFallbacks) {
					return false;
				}
			}
			return true;
		}
		if (statusCode === 401 || statusCode === 403) {
			// PY: 检查同组全体部署数(not just healthy); _all_deployments总数<=1则抛出
			const allSameGroup = this._deployments.filter((d) => d.model_name === model);
			if (allSameGroup.length <= 1) {
				return false;
			}
			return true;
		}
		if (statusCode === 408 || statusCode === 409) {
			return true;
		}
		return statusCode >= 500;
	}

	/**
	 * 对齐 PY _time_to_sleep_before_retry。
	 * 同组有健康部署时返回 0（立即转其他部署），否则计算标准退避。
	 * @param model
	 * @param attempt
	 * @param retryAfterHeader
	 */ private _timeToSleepBeforeRetry(model: string, attempt: number, retryAfterHeader?: string): number {
		const sameGroupHasHealthy = this._deployments.some(
			(d) => d.model_name === model && !this._cooldownManager.isInCooldown(this._getDeploymentKey(d)),
		);
		if (sameGroupHasHealthy) {
			return 0;
		}
		return this._calculateBackoff(attempt, retryAfterHeader);
	}

	/**
	 * Parse Retry-After header value into seconds.
	 * Supports both integer seconds and HTTP-date format.
	 * @param header - Retry-After header value
	 * @returns seconds to wait, or null if unparseable
	 */
	private _parseRetryAfterSeconds(header: string): number | null {
		const seconds = parseInt(header, 10);
		if (!isNaN(seconds) && seconds > 0) {
			return seconds;
		}
		const parsed = Date.parse(header);
		if (!isNaN(parsed)) {
			const diff = (parsed - Date.now()) / 1000;
			if (diff > 0) {
				return diff;
			}
		}
		return null;
	}

	private _calculateBackoff(attempt: number, retryAfterHeader?: string): number {
		if (retryAfterHeader) {
			const seconds = this._parseRetryAfterSeconds(retryAfterHeader);
			if (seconds !== null && seconds <= 60) {
				// PY: retry_after + JITTER*random, 返回单位为秒
				return seconds + Math.random() * 0.75;
			}
		}
		const minTimeoutMs = this._retryAfter * 1000;
		const MAX_RETRY_DELAY_MS = 8000;
		let baseMs = Math.min(Router._initialRetryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
		if (minTimeoutMs > 0) {
			baseMs = Math.max(baseMs, minTimeoutMs);
		}
		// PY: apply MAX_RETRY_DELAY hard cap after min_timeout (min(sleep, 8.0))
		baseMs = Math.min(baseMs, MAX_RETRY_DELAY_MS);
		const jitter = Math.random() * 750;
		return Math.round(baseMs + jitter) / 1000; // return seconds to match PY
	}

	private _getDeploymentKey(deployment: Deployment): string {
		// PY: uses model_info.id only (no fallback)
		return deployment.model_info?.id ?? deployment.model_name;
	}

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	async acompletion(model: string, messages: Message[], optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		return this.completion(model, messages, optionalParams);
	}

	/**
	 * @param modelName
	 */
	markFailed(modelName: string): void {
		this._cooldownManager.markFailed(modelName, this._cooldownTimeMs);
	}

	/**
	 * @param model
	 * @param fallbackDepth
	 */
	getNextFallback(model: string, fallbackDepth: number): string | null {
		return this._fallbackHandler.getNextFallback(model, fallbackDepth);
	}

	/**
	 * @param modelName
	 * @param delta
	 */
	trackActiveRequest(modelName: string, delta: number): void {
		const current = this._activeRequests.get(modelName) ?? 0;
		this._activeRequests.set(modelName, Math.max(0, current + delta));
	}
}
