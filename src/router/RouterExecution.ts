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
import { ApiError, HTTP_STATUS, formatNoDeploymentsAvailableMessage } from "../core/api/ApiError";
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
import { buildDeploymentSpendInfo } from "./RouterSpendInfo";
import { maskCooldownEntries } from "./CooldownMasking";
import type { Deployment, RetryPolicy } from "../types/router";
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
 * PY route_llm_request 中 acompletion 的 route 名（litellm/proxy/route_llm_request.py
 * ROUTE_ENDPOINT_MAPPING 映射），用于未知模型 400 消息——Router.completion 主循环
 * 对应 PY acompletion 入口。
 */
export const CHAT_COMPLETIONS_ROUTE_NAME = "/chat/completions";

/**
 * PY ProxyException 对无 type/param 属性的异常以字符串 "None" 填充
 * （getattr(e, "type", "None")，对齐 ApiError 的 PYTHON_NONE_FILL）。
 */
const PYTHON_NONE_FILL = "None";

/**
 * 构造 PY ProxyModelNotFoundError detail 的 dict repr 消息（litellm/proxy/route_llm_request.py:100）：
 * `{'error': '<route>: Invalid model name passed in model=<model>. Call \`/v1/models\` to view available models for your key.'}`
 * PY 实测为单引号 dict repr（HTTPException detail 经 ProxyException str() 序列化）。
 * @param route - PY route 名（如 "/chat/completions" / "anthropic_messages"）
 * @param model - 客户端请求的模型名
 */
export function formatInvalidModelMessage(route: string, model: string): string {
	return `{'error': '${route}: Invalid model name passed in model=${model}. Call \`/v1/models\` to view available models for your key.'}`;
}

/**
 * 构造未知模型 400 错误（PY ProxyModelNotFoundError 对齐）：
 * HTTP 400 + type/param 均为 "None"。/v1/messages 路径的消息需再加 "400: " 前缀
 * （PY anthropic_messages 端点 str(HTTPException) 包装），由调用方拼接。
 * @param message - formatInvalidModelMessage 产出（或其加前缀变体）
 */
export function buildInvalidModelError(message: string): ApiError {
	return new ApiError(HTTP_STATUS.BAD_REQUEST, message, PYTHON_NONE_FILL, PYTHON_NONE_FILL);
}

/**
 * 模型存在性判定（忽略冷却状态），区分"模型不存在"（400）与"模型存在但全部署冷却"（429）。
 * 对齐 PY route_llm_request 校验层（litellm/proxy/route_llm_request.py:477-498）：
 * model_list pattern 命中（含 alias 解析、通配符、provider 前缀剥离）/
 * deployment id 命中（PY has_model_id）/ litellm_params.model 命中（PY deployment_names）。
 * fallback 命中不在此判定——主循环在有 fallback 时已递归，到达本判定点即无 fallback。
 * @param deployments - 全部署列表
 * @param matchDeploymentPattern - deployment 与模型名的 pattern 匹配函数
 * @param resolvedModel - model_group_alias 解析后的模型名
 * @param rawModel - 客户端请求的原始模型名（deployment id / deployment_names 匹配用）
 */
export function isKnownModel(
	deployments: Deployment[],
	matchDeploymentPattern: MatchDeploymentPatternFn,
	resolvedModel: string,
	rawModel: string,
): boolean {
	return deployments.some(
		(dep) => matchDeploymentPattern(dep, resolvedModel) || dep.model_info?.id === rawModel || dep.litellm_params.model === rawModel,
	);
}

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
		// 每个 model 查自身 fallback 链的链首（depth 恒为 0）；
		// fallbackDepth 仅是跳数计数器（max_fallbacks 上限 / 响应头 attemptedFallbacks）
		const nextFallback = ctx.fallbackHandler.getNextFallback(model, 0);
		if (nextFallback) {
			return executeWithFallback(ctx, { ...req, fallbackDepth: fallbackDepth + 1, model: nextFallback }, helpers);
		}
		// 模型不存在（model_list/alias 无命中、非 deployment id、非 deployment_names，
		// 且无 fallback——有 fallback 上面已递归）→ 400，对齐 PY route_llm_request
		// ProxyModelNotFoundError；模型存在但全部署冷却 → 走下方 429 no-deployments。
		if (!isKnownModel(ctx.deployments, matchDeploymentPattern, resolvedModel, model)) {
			throw buildInvalidModelError(formatInvalidModelMessage(CHAT_COMPLETIONS_ROUTE_NAME, model));
		}
		// DIFF-RT-02 + DIFF-RT-04: healthy=0 且无 fallback 时，对齐 PY router.py:9445,9507
		// 抛 RouterRateLimitErrorBasic 携带 cooldown_time + cooldown_list 字段。
		// 消息文本对齐 PY RouterRateLimitError（types/router.py:688）实测格式。
		const activeCooldowns = ctx.cooldownManager.getActiveCooldowns(candidateKeys);
		const minCooldownMs = ctx.cooldownManager.getMinCooldown(candidateKeys);
		const cooldownList = activeCooldowns.length > 0 ? maskCooldownEntries(activeCooldowns) : undefined;
		// PY cooldown_time 取 CooldownCacheValue.cooldown_time（配置时长）的最小值，无冷却条目时回退默认 cooldown_time
		const cooldownSeconds =
			(activeCooldowns.length > 0
				? Math.min(...activeCooldowns.map(([, cacheValue]) => cacheValue.cooldown_time))
				: ctx.cooldownTimeMs) / 1000;
		// PY cooldown_list 为全模型组范围（cooldown_handlers.py _get_cooldown_deployments 遍历全部 model_ids）
		const allDeploymentKeys = ctx.deployments.map((dep) => getDeploymentKey(dep));
		const allActiveCooldownKeys = ctx.cooldownManager.getActiveCooldowns(allDeploymentKeys).map(([deploymentKey]) => deploymentKey);
		throw new RouterRateLimitErrorBasic(
			formatNoDeploymentsAvailableMessage(model, {
				cooldownSeconds: cooldownSeconds,
				cooldownList: allActiveCooldownKeys,
				preCallChecks: ctx.preCallChecks,
			}),
			{
				model: model,
				cooldown_time: minCooldownMs > 0 ? minCooldownMs : undefined,

				cooldown_list: cooldownList,
			},
		);
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
					const nextFallback = ctx.fallbackHandler.getNextFallback(model, 0);
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
	let originalError: Error | null = null;

	try {
		let lastError: Error | null = null;
		const deploymentRetries = deployment.litellm_params.num_retries ?? ctx.numRetries;
		let maxRetries = deploymentRetries > 0 ? deploymentRetries : 0;
		let maxRetriesForHeaders = maxRetries;

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
					const categorizedError = categorizeProviderError(response.status, bodyStr);
					lastError = categorizedError;
					if (originalError === null) {
						originalError = categorizedError;
					}
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
					maxRetriesForHeaders = responseEffectiveMaxRetries;
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
					const providerHeaders = (response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders;
					const responseHeaders = buildResponseHeaders(deployment, providerHeaders, {
						attemptedFallbacks: fallbackDepth,
						attemptedRetries: attempt,
						maxRetries: maxRetriesForHeaders,
					});
					return {
						_stream: true,
						stream: stream,
						_provider: deployment.model_name,
						_fallbackDepth: fallbackDepth,
						_customCostPerToken: deployment.litellm_params.custom_cost_per_token,
						// 批次 9: spend 记账对齐 — 实际执行 deployment 的 provider/api_base/model_id/model_info 价格
						_spendInfo: buildDeploymentSpendInfo(deployment, execResult.upstreamUrl),
						_providerHeaders: responseHeaders,
					};
				}

				const transformed = provider.transformResponse(deployment.litellm_params.model, body);
				invokeRouterCallback(ctx.routerCallbacks, "onSuccess", deployment, transformed, Date.now() - startTime);

				const providerHeaders = (response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders;
				const responseHeaders = buildResponseHeaders(deployment, providerHeaders, {
					attemptedFallbacks: fallbackDepth,
					attemptedRetries: attempt,
					maxRetries: maxRetriesForHeaders,
				});

				return {
					...transformed,
					_provider: deployment.model_name,
					_fallbackDepth: fallbackDepth,
					_customCostPerToken: deployment.litellm_params.custom_cost_per_token,
					// 批次 9: spend 记账对齐 — 实际执行 deployment 的 provider/api_base/model_id/model_info 价格
					_spendInfo: buildDeploymentSpendInfo(deployment, execResult.upstreamUrl),
					_providerHeaders: responseHeaders,
				};
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (originalError === null) {
					originalError = lastError;
				}

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
				maxRetriesForHeaders = effectiveMaxRetries;

				if (attempt >= effectiveMaxRetries) {
					throw originalError ?? lastError;
				}

				retryAfterHeader = extractRetryAfterFromError(lastError);
				if (attempt < effectiveMaxRetries) {
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

		throw originalError ?? lastError ?? new Error("Unknown error during completion");
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
			// PY deployment_callback_on_failure：缺省冷却时长取 router.cooldown_time
			// （litellm/router.py:6176-6180 `_time_to_cooldown = self.cooldown_time`），
			// 与 Router.recordDeploymentFailure 的直连路径一致；retry_after 仅是
			// 重试退避下限，不能作为冷却缺省（未配置时为 0 导致冷却空操作）。
			ctx.cooldownTimeMs,
			ctx.cooldownManager,
		);
		if (decision.shouldCooldown) {
			ctx.cooldownManager.markFailed(depKey, decision.cooldownDurationMs, decision.statusCode, error.message);
			ctx.cooldownManager.recordFailure(depKey);
		}

		const nextFallback = ctx.fallbackHandler.getNextFallback(model, 0);
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
