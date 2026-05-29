/**
 * RouterExecution — _executeWithFallback 主循环
 *
 * 把 Router 中最庞大的 _executeWithFallback 实现抽到独立模块。
 * 通过一个 RouterExecContext 暴露 Router 的状态/依赖（cooldown / tpmRpmLimiter /
 * fallbackHandler / provider registry / counts maps 等），让主循环只关心控制流。
 *
 * 对齐 PY `router.py:5537-5963` 的 async_function_with_fallbacks。
 *
 * 子模块拆分（T18 修复 >500 effective lines）：
 *   - RouterExecutionTypes.ts            —— 共享类型（RouterExecContext / helpers）
 *   - RouterExecutionFallbackDispatch.ts —— CW/CP/general fallback 派发
 *   - RouterExecutionBackoff.ts          —— 重试前 sleep 秒数计算
 */

import { ContextWindowExceededError, ContentPolicyViolationError, InternalServerError, RouterRateLimitErrorBasic } from "./RouterErrors";
import { logger } from "../core/utils/logger";
import {
	categorizeProviderError,
	extractRetryAfterFromError,
	extractRetryAfterFromResponse,
	checkContentFilterOn200Response,
	buildCooldownDecision,
} from "./RouterExecutor";
import { getRetryPolicyOverride, shouldRetryThisError } from "./RouterRetryPolicy";
import { getDeploymentKey, getModelGroupName } from "./RouterModelGroupCache";
import { invokeRouterCallback } from "./RouterCallbacks";
import { buildResponseHeaders } from "./RouterResponseHeaders";
import { maskCooldownEntries } from "./CooldownMasking";
import type { RetryPolicy } from "../types/router";
import { tryRouteToFallback, tryRouteToFallbackForMock, FallbackErrorKind } from "./RouterExecutionFallbackDispatch";
import { computeSleepBeforeRetry } from "./RouterExecutionBackoff";
import type {
	RouterExecContext,
	ExecutionRequest,
	ExecutionHelpers,
	GetCandidateFn,
	EstimateInputTokensFn,
	ExecuteRequestFn,
	MatchDeploymentPatternFn,
	GetHealthyDeploymentsFn,
	DispatchMockPreviousErrorFn,
} from "./RouterExecutionTypes";

// 透传共享类型，外部模块（Router.ts 等）继续从本文件 import
export type {
	RouterExecContext,
	ExecutionRequest,
	ExecutionHelpers,
	GetCandidateFn,
	EstimateInputTokensFn,
	ExecuteRequestFn,
	MatchDeploymentPatternFn,
	GetHealthyDeploymentsFn,
	DispatchMockPreviousErrorFn,
};

/**
 * 主入口：执行带 fallback 的 completion。行为完全等价于 Router._executeWithFallback，
 * 拆分目的仅为控制 Router.ts 行数。
 * @param ctx
 * @param req
 * @param helpers
 */
export async function executeWithFallback(
	ctx: RouterExecContext,
	req: ExecutionRequest,
	helpers: ExecutionHelpers,
): Promise<Record<string, unknown>> {
	const { model, messages, optionalParams, fallbackDepth, previousError } = req;
	const { getCandidate, estimateInputTokens, executeRequest, matchDeploymentPattern, getHealthyDeployments } = helpers;

	if (fallbackDepth >= ctx.maxFallbacks) {
		throw previousError ?? new Error(`Max fallback depth (${ctx.maxFallbacks}) reached for model "${model}"`);
	}

	// GAP (MOCK-001): 异步入口 mock_testing_* 钩子抛出的异常（previousError），
	// 按异常类型路由到对应的专属 fallback chain（对齐 PY async_function_with_retries）。
	if (previousError !== undefined && fallbackDepth === 0) {
		// 顺序：CW → CP → general（不传 previousError，因为这是 mock 入口的初始派发）
		const mockDispatch = tryRouteToFallbackForMock({
			ctx: ctx,
			req: req,
			helpers: helpers,
			model: model,
			error: previousError,
			runExecution: executeWithFallback,
		});
		if (mockDispatch) {
			return mockDispatch;
		}
		// DIFF-015: 无 general fallback 时，直接 rethrow mock_testing_fallbacks 抛的异常，
		// 避免被后续 fetch 路径的 TypeError 覆盖（PY 行为：始终抛 InternalServerError）。
		if (previousError instanceof InternalServerError) {
			throw previousError;
		}
	}

	// PY: per-request model_group_retry_policy - simple replace, no merge (GAP #15)
	const perRequestRetryPolicy = optionalParams["model_group_retry_policy"] as Record<string, RetryPolicy> | undefined;
	const effectiveRetryPolicyOverride: Record<string, RetryPolicy> | undefined = perRequestRetryPolicy ?? ctx.modelGroupRetryPolicy;
	// DIFF-RT-02: 优先用 FallbackHandler.resolveModelGroup 解析（合并 alias 路径）
	const resolvedModel = ctx.fallbackHandler.resolveModelGroup(model);
	// GAP 10: 从分布式 cache backend (Redis 等) warm 本地 cooldown 状态
	const candidateKeys = ctx.deployments.filter((d) => matchDeploymentPattern(d, resolvedModel)).map((d) => getDeploymentKey(d));
	if (candidateKeys.length > 0) {
		await ctx.cooldownManager.hydrateFromBackend(candidateKeys);
	}
	const candidate = getCandidate(resolvedModel, messages);

	if (!candidate) {
		const nextFallback = ctx.fallbackHandler.getNextFallback(model, fallbackDepth);
		if (nextFallback) {
			return executeWithFallback(ctx, { ...req, fallbackDepth: fallbackDepth + 1, model: nextFallback }, helpers);
		}
		// DIFF-RT-02 + DIFF-RT-04: healthy=0 且无 fallback 时，对齐 PY router.py:9445,9507
		// 抛 RouterRateLimitErrorBasic 携带 cooldown_time + cooldown_list 字段。
		const activeCooldowns = ctx.cooldownManager.getActiveCooldowns(candidateKeys);
		const minCooldownMs = ctx.cooldownManager.getMinCooldown(candidateKeys);
		const cooldownList = activeCooldowns.length > 0 ? maskCooldownEntries(activeCooldowns) : undefined;
		throw new RouterRateLimitErrorBasic(`No available deployment for model "${model}" and no fallbacks remaining`, {
			model: model,
			cooldown_time: minCooldownMs > 0 ? minCooldownMs : undefined,
			// eslint-disable-next-line camelcase
			cooldown_list: cooldownList,
		});
	}

	const { deployment, provider } = candidate;
	// GAP 6/9: 跟踪 pre_call_checks 是否已通过 atomic checkAndReserve 占用 RPM slot，
	// 避免成功路径重复 incrementRequest 造成 double-count。
	let rpmSlotPreReserved = false;

	const depKey = getDeploymentKey(deployment);

	if (ctx.preCallChecks) {
		if (!ctx.optionalPreCallChecks || ctx.optionalPreCallChecks["deployment_affinity"] !== false) {
			const maxInputTokens = deployment.model_info?.max_input_tokens;
			if (maxInputTokens !== undefined) {
				const estimatedTokens = estimateInputTokens(messages);
				if (estimatedTokens > maxInputTokens) {
					logger.warn(`Context window exceeded on ${deployment.model_name}: estimated ${estimatedTokens} > ${maxInputTokens}`);
					throw new ContextWindowExceededError(
						`Context window exceeded on ${deployment.model_name}: estimated ${estimatedTokens} > ${maxInputTokens}`,
					);
				}
			}
		}
		if (!ctx.optionalPreCallChecks || ctx.optionalPreCallChecks["model_rate_limit"] !== false) {
			const rpmLimit = deployment.litellm_params.rpm;
			const tpmLimit = deployment.litellm_params.tpm;
			if (rpmLimit !== undefined || tpmLimit !== undefined) {
				const estimatedInputTokens = estimateInputTokens(messages);
				const reserved = await ctx.tpmRpmLimiter.checkAndReserve(depKey, tpmLimit, rpmLimit, estimatedInputTokens);
				if (!reserved) {
					const usage = ctx.tpmRpmLimiter.getUsage(depKey);
					logger.warn(
						`Rate limit reached on ${deployment.model_name} (rpm=${usage.rpm}/${rpmLimit ?? "-"}, tpm=${usage.tpm}/${tpmLimit ?? "-"}), trying fallback`,
					);
					const nextFallback = ctx.fallbackHandler.getNextFallback(model, fallbackDepth);
					if (nextFallback) {
						return executeWithFallback(ctx, { ...req, fallbackDepth: fallbackDepth + 1, model: nextFallback }, helpers);
					}
					throw new Error(
						`Rate limit exceeded on ${deployment.model_name} and no fallback available (rpm=${usage.rpm}/${rpmLimit ?? "-"}, tpm=${usage.tpm}/${tpmLimit ?? "-"})`,
					);
				}
				rpmSlotPreReserved = true;
			}
		}
	}

	const currentActive = ctx.activeRequests.get(depKey) ?? 0;
	ctx.activeRequests.set(depKey, currentActive + 1);

	const startTime = Date.now();
	let retryAfterHeader: string | undefined;

	try {
		let lastError: Error | null = null;
		const deploymentRetries = deployment.litellm_params.num_retries ?? ctx.numRetries;
		let maxRetries = deploymentRetries > 0 ? deploymentRetries : 0;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const execResult = await executeRequest(provider, deployment, messages, optionalParams);
				const { response, body, ttft, stream } = execResult;
				const elapsed = Date.now() - startTime;
				const usageForLatency = (body as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
				const completionTokens =
					usageForLatency && typeof usageForLatency["completion_tokens"] === "number"
						? (usageForLatency["completion_tokens"] as number)
						: undefined;
				const normalizedLatency = completionTokens && completionTokens > 0 ? elapsed / completionTokens : elapsed;

				const samples = ctx.latencySamples.get(depKey) ?? [];
				samples.push(normalizedLatency);
				if (samples.length > ctx.recentLatencyCount) {
					samples.shift();
				}
				ctx.latencySamples.set(depKey, samples);
				const avgLatency = samples.reduce((a, b) => a + b, 0) / samples.length;
				ctx.latencies.set(depKey, avgLatency);

				const isStreamReq = optionalParams["stream"] === true;
				if (isStreamReq && completionTokens && completionTokens > 0) {
					const streamTtft = ttft > 0 ? ttft : elapsed;
					ctx.ttft.set(depKey, streamTtft / completionTokens);
				}

				if (!response.ok) {
					const bodyStr = JSON.stringify(body);
					lastError = new Error(`Provider returned ${response.status}: ${bodyStr}`);

					const categorizedError = categorizeProviderError(response.status, bodyStr);
					retryAfterHeader = extractRetryAfterFromResponse(response);

					if (categorizedError instanceof ContextWindowExceededError || categorizedError instanceof ContentPolicyViolationError) {
						const dispatched = tryRouteToFallback({
							ctx: ctx,
							req: req,
							helpers: helpers,
							model: model,
							error: categorizedError,
							deployment: deployment,
							errorKind: FallbackErrorKind.Categorized,
							runExecution: executeWithFallback,
						});
						if (dispatched) {
							return dispatched;
						}
					}

					const retryPolicyOverride = getRetryPolicyOverride(
						categorizedError,
						ctx.retryPolicy,
						model,
						ctx.modelGroupRetryPolicy,
						effectiveRetryPolicyOverride,
					);

					let shouldRetry: boolean;
					if (retryPolicyOverride !== undefined) {
						shouldRetry = true;
					} else {
						try {
							shouldRetry = shouldRetryThisError(
								response.status,
								model,
								categorizedError,
								ctx.fallbackHandler,
								ctx.deployments.length,
								getHealthyDeployments(model).length,
							);
						} catch (shouldRetryErr) {
							lastError = shouldRetryErr instanceof Error ? shouldRetryErr : categorizedError;
							throw lastError;
						}
					}
					if (!shouldRetry) {
						break;
					}

					const responseEffectiveMaxRetries = retryPolicyOverride !== undefined ? retryPolicyOverride : maxRetries;
					if (attempt < responseEffectiveMaxRetries) {
						invokeRouterCallback(ctx.routerCallbacks, "onRetry", deployment, attempt, categorizedError);
						const sleepSec = computeSleepBeforeRetry({
							error: categorizedError,
							numRetries: attempt,
							healthyDeployments: getHealthyDeployments(model),
							allDeployments: ctx.deployments,
							retryAfterHeader: retryAfterHeader,
							extractFromError: extractRetryAfterFromError,
							cooldownTimeMs: ctx.retryAfter * 1000,
						});
						if (sleepSec === 0) {
							continue;
						} else {
							await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
						}
					}
					continue;
				}

				// GAP #11: PY checks 200 responses for content_filter finish_reason
				checkContentFilterOn200Response(body, model, deployment.model_name, ctx.fallbackHandler);

				ctx.cooldownManager.clearCooldown(depKey);
				ctx.cooldownManager.recordSuccess(depKey);
				if (!rpmSlotPreReserved) {
					ctx.tpmRpmLimiter.incrementRequest(depKey);
				}

				try {
					const usage = (body as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
					if (usage && (usage["total_tokens"] as number)) {
						ctx.tpmRpmLimiter.incrementTokens(depKey, usage["total_tokens"] as number);
					}
				} catch {
					// Token tracking is best-effort
				}

				if (isStreamReq && stream) {
					invokeRouterCallback(ctx.routerCallbacks, "onSuccess", deployment, body, Date.now() - startTime);
					return {
						_stream: true,
						stream: stream,
						_provider: deployment.model_name,
						_fallbackDepth: fallbackDepth,
						_customCostPerToken: deployment.litellm_params.custom_cost_per_token,
						_providerHeaders: (response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders,
					};
				}

				const transformed = provider.transformResponse(deployment.litellm_params.model, body);
				invokeRouterCallback(ctx.routerCallbacks, "onSuccess", deployment, transformed, Date.now() - startTime);

				const providerHeaders = (response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders;
				const responseHeaders = buildResponseHeaders(deployment, providerHeaders);

				return {
					...transformed,
					_provider: deployment.model_name,
					_fallbackDepth: fallbackDepth,
					_customCostPerToken: deployment.litellm_params.custom_cost_per_token,
					_providerHeaders: responseHeaders,
				};
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));

				const errWithRetries = lastError as unknown as { num_retries?: unknown };
				const hasExceptionNumRetries =
					typeof errWithRetries.num_retries === "number" &&
					Number.isInteger(errWithRetries.num_retries) &&
					errWithRetries.num_retries >= 0;
				if (hasExceptionNumRetries) {
					maxRetries = errWithRetries.num_retries as number;
				} else if (typeof deployment.litellm_params.num_retries === "number" && deployment.litellm_params.num_retries >= 0) {
					errWithRetries.num_retries = deployment.litellm_params.num_retries;
					maxRetries = deployment.litellm_params.num_retries;
				}

				if (lastError instanceof ContextWindowExceededError || lastError instanceof ContentPolicyViolationError) {
					const dispatched = tryRouteToFallback({
						ctx: ctx,
						req: req,
						helpers: helpers,
						model: model,
						error: lastError,
						deployment: deployment,
						errorKind: FallbackErrorKind.Catch,
						runExecution: executeWithFallback,
					});
					if (dispatched) {
						return dispatched;
					}
				}

				const policyOverride = getRetryPolicyOverride(
					lastError,
					ctx.retryPolicy,
					model,
					ctx.modelGroupRetryPolicy,
					effectiveRetryPolicyOverride,
				);
				const effectiveMaxRetries = policyOverride !== undefined ? policyOverride : maxRetries;

				if (attempt >= effectiveMaxRetries) {
					throw lastError;
				}

				retryAfterHeader = extractRetryAfterFromError(lastError);
				if (attempt < maxRetries) {
					invokeRouterCallback(ctx.routerCallbacks, "onRetry", deployment, attempt, lastError);
					const sleepSec = computeSleepBeforeRetry({
						error: lastError,
						numRetries: attempt,
						healthyDeployments: getHealthyDeployments(model),
						allDeployments: ctx.deployments,
						retryAfterHeader: retryAfterHeader,
						extractFromError: extractRetryAfterFromError,
						cooldownTimeMs: ctx.retryAfter * 1000,
					});
					if (sleepSec === 0) {
						continue;
					}
					await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
				}
			}
		}

		throw lastError ?? new Error("Unknown error during completion");
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));

		ctx.failCalls.set(depKey, (ctx.failCalls.get(depKey) ?? 0) + 1);
		ctx.totalCalls.set(depKey, (ctx.totalCalls.get(depKey) ?? 0) + 1);

		const failureLatencySec = ctx.failureLatencyPenaltySec;
		const failureSamples = ctx.latencySamples.get(depKey) ?? [];
		failureSamples.push(failureLatencySec * 1000);
		if (failureSamples.length > ctx.recentLatencyCount) {
			failureSamples.shift();
		}
		ctx.latencySamples.set(depKey, failureSamples);
		const failureAvg = failureSamples.reduce((a, b) => a + b, 0) / failureSamples.length;
		ctx.latencies.set(depKey, failureAvg);
		if (optionalParams["stream"] === true) {
			ctx.ttft.set(depKey, failureLatencySec * 1000);
		}

		// DIFF-008: 同模型组部署数（与 Router._countSameGroupDeployments 等价）
		const targetGroup = getModelGroupName(deployment);
		const sameGroupCount = ctx.deployments.filter((d) => getModelGroupName(d) === targetGroup).length;

		const decision = buildCooldownDecision(
			deployment,
			error,
			sameGroupCount,
			retryAfterHeader,
			ctx.retryAfter * 1000,
			ctx.cooldownManager,
		);
		if (decision.shouldCooldown) {
			ctx.cooldownManager.markFailed(depKey, decision.cooldownDurationMs, decision.statusCode, error.message);
			ctx.cooldownManager.recordFailure(depKey);
		}

		const nextFallback = ctx.fallbackHandler.getNextFallback(model, fallbackDepth);
		if (nextFallback) {
			return executeWithFallback(
				ctx,
				{ ...req, fallbackDepth: fallbackDepth + 1, model: nextFallback, previousError: error },
				helpers,
			);
		}

		const maxRetries = ctx.numRetries;
		const fallbacksList = ctx.fallbackHandler.getFallbackChain(model);
		const augmented = error as unknown as {
			num_retries?: number;
			max_retries?: number;
			requested_model?: string;
		};
		augmented.max_retries = maxRetries;
		augmented.num_retries = maxRetries + 1;
		// eslint-disable-next-line camelcase
		augmented.requested_model = model;
		error.message = `${error.message}. Received Model Group=${model}\nAvailable Model Group Fallbacks=[${fallbacksList.join(", ")}]`;
		logger.debug(`track_deployment_metrics: model=${model} total=${ctx.totalCalls.get(depKey)} fail=${ctx.failCalls.get(depKey)}`);

		invokeRouterCallback(ctx.routerCallbacks, "onFailure", deployment, error);
		throw error;
	} finally {
		const active = ctx.activeRequests.get(depKey) ?? 1;
		ctx.activeRequests.set(depKey, Math.max(0, active - 1));
	}
}
