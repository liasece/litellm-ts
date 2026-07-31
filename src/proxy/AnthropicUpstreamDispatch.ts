/**
 * AnthropicUpstreamDispatch — Anthropic Messages 端点的上游派发与 fallback 链执行
 *
 * /v1/messages 端点是手工 fetch 透传（不走 Router.completion），因此 fallback /
 * 冷却 / model 替换需要在端侧显式编排。本模块把这套编排抽成独立算法：
 *
 *   - buildUpstreamAttempt      —— 选 deployment 并构造上游 URL/headers/上游 model 名
 *   - executeWithFallbackChain  —— 同组 deployment 循环 + Router fallback 链重试
 *
 * 冷却副作用全部委托 Router.recordDeploymentSuccess / recordDeploymentFailure
 * （内部复用 RouterExecution 同一套 CooldownManager + buildCooldownDecision），
 * 本模块不自造冷却逻辑。
 *
 * fallback 语义对齐 RouterExecution.executeWithFallback（src/router/RouterExecution.ts）：
 *   - 当前 model 的可用 deployment 全部失败后，getNextFallback(currentModel, 0)
 *     查当前 model 自身 fallback 链的链首；fallbackDepth 仅是跳数计数器，直到链耗尽
 *   - model_group_alias 解析先于 deployment 选择（getAvailableDeployment /
 *     getFallbackChain 内部均已 resolveModelGroup）
 *   - 仅 provider 侧错误（上游 HTTP 非 2xx / 网络错误）进入本循环触发 fallback；
 *     本地 4xx 请求构造错误在 execute 之前抛出，天然不 fallback。
 *     与 Python 实测一致：GLM 400（1211 模型不存在 / 1309 套餐到期）也 fallback。
 */
import { ApiError, type NoDeploymentsErrorInfo } from "../core/api/ApiError";
import { createModuleLogger } from "../core/utils/logger";
import { APIConnectionError } from "../router/RouterErrors";
import { buildInvalidModelError, formatInvalidModelMessage } from "../router/RouterExecution";
import { getDeploymentKey } from "../router/RouterModelGroupCache";
import {
	appendModelResolutionTrace,
	copyModelResolutionChain,
	createModelResolutionTraceCollector,
	type ModelGroupResolution,
	type ModelResolutionChainEntry,
	type ModelResolutionTraceCollector,
} from "../router/ModelResolutionTrace";
import type { Deployment } from "../types/router";
import type { ProviderConfig } from "../types/provider";

const logger = createModuleLogger("AnthropicDispatch");

/**
 * PY route_llm_request 中 /v1/messages 的 route_type（未入 ROUTE_ENDPOINT_MAPPING，
 * 按原名使用），用于未知模型 400 消息。
 */
const ANTHROPIC_MESSAGES_ROUTE_NAME = "anthropic_messages";

/**
 * Provider 上游 HTTP 错误（非 2xx）。message 中保留 3 位状态码，
 * 供冷却决策 castExceptionStatusToInt 解析（正则 \b(\d{3})\b）。
 */
export class ProviderUpstreamError extends Error {
	override readonly name = "ProviderUpstreamError";

	constructor(
		/** 上游 HTTP 状态码 */
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** 单次上游直连尝试所需的一切（URL / headers / deployment / 上游 model 名） */
export interface UpstreamAttempt {
	/** 上游完整 URL（provider.transformRequest 产出，含 deployment.api_base 覆盖） */
	readonly upstreamUrl: string;
	/** 上游请求头（含鉴权） */
	readonly upstreamHeaders: Record<string, string>;
	/** 本次选中的 deployment（用于冷却登记） */
	readonly deployment: Deployment;
	/** deployment 稳定 key（model_info.id ?? model_name），用于已尝试去重 */
	readonly deploymentKey: string;
	/** 剥离 provider 前缀后的上游 model 名（写入转发 body.model） */
	readonly upstreamModel: string;
}

/**
 * executeWithFallbackChain 依赖的 Router 能力子集。
 * 与 Router 类的同名方法结构兼容，测试可用 mock 注入。
 */
export interface FallbackRouterFacade {
	/** 选取一个可用 deployment（内部已解析 model_group_alias 并排除冷却中的实例） */
	getAvailableDeployment(model: string): { deployment: Deployment; provider: ProviderConfig } | null;
	/** 解析逻辑模型并返回完整 alias 路径。 */
	resolveModelGroupWithTrace?(model: string): ModelGroupResolution;
	/** 取该 model 自身 fallback 链上第 fallbackDepth 跳的 model 名，链耗尽返回 null（调用方恒传 0 取链首） */
	getNextFallback(model: string, fallbackDepth: number): string | null;
	/** 结构化 fallback 解析，保留 fallback 配置中的 alias 输入。 */
	getNextFallbackWithTrace?(model: string, fallbackDepth: number): ModelGroupResolution | null;
	/** 单 deployment 调用成功登记（清冷却 + 失败计数清零） */
	recordDeploymentSuccess(deployment: Deployment): void;
	/** 单 deployment 调用失败登记（buildCooldownDecision 判定后按决策冷却） */
	recordDeploymentFailure(deployment: Deployment, error: Error): void;
	/** 判断模型是否已知（忽略冷却状态）：未知 → 400，已知但全部署冷却 → 429 */
	hasModel(model: string): boolean;
	/** 模型组冷却上下文（构造 Python 风格 no-deployments 错误用） */
	getNoAvailableDeploymentInfo(model: string): NoDeploymentsErrorInfo;
	/** fallback 链最大跳数上限（max_fallbacks 配置，防环型配置死循环） */
	readonly maxFallbacks: number;
}

/**
 * 剥离 provider 前缀（"anthropic/glm-4.7" → "glm-4.7"）。
 * 与 AnthropicProvider._stripProviderPrefix 行为一致：无条件剥离首个 "/" 前段。
 * @param model - deployment.litellm_params.model
 */
export function stripProviderPrefix(model: string): string {
	const slashIndex = model.indexOf("/");
	if (slashIndex !== -1) {
		return model.slice(slashIndex + 1);
	}
	return model;
}

/**
 * 选取 model 的一个可用 deployment 并构造上游直连参数。
 * @param router - Router 能力子集
 * @param model - 路由 model 名（websearch override 之后）
 * @param requestApiKey - 客户端请求透传的 api_key（兜底）
 * @param requestAnthropicVersion - 客户端请求透传的 anthropic-version
 * @returns 上游尝试参数；无可用 deployment 时返回 null
 */
export function buildUpstreamAttempt(
	router: FallbackRouterFacade,
	model: string,
	requestApiKey?: string,
	requestAnthropicVersion?: string,
): UpstreamAttempt | null {
	const candidate = router.getAvailableDeployment(model);
	if (!candidate) {
		return null;
	}
	const { deployment, provider } = candidate;
	// deployment.litellm_params.api_key 优先，requestApiKey 兜底（用户请求头透传）
	const apiKey = (deployment.litellm_params.api_key as string | undefined) ?? requestApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
	const anthropicVersion = requestAnthropicVersion ?? "2023-06-01";
	const deploymentModel = deployment.litellm_params.model ?? model;
	// 原生支持 Anthropic Messages 的 provider（如 DeepSeek）使用自己的协议出口；
	// 其余 provider 沿用 transformRequest 构造 URL/headers。
	const requestParams = {
		...deployment.litellm_params,
		api_key: apiKey,
		anthropic_version: anthropicVersion,
	};
	const providerReq = provider.transformAnthropicRequest
		? provider.transformAnthropicRequest(deploymentModel, requestParams)
		: provider.transformRequest(deploymentModel, [], requestParams);
	return {
		upstreamUrl: providerReq.url,
		upstreamHeaders: providerReq.headers,
		deployment: deployment,
		deploymentKey: getDeploymentKey(deployment),
		upstreamModel: stripProviderPrefix(deploymentModel),
	};
}

/**
 * 构造 /v1/messages 家族端点的未知模型 400。
 * PY 实测：anthropic_messages 端点把 ProxyModelNotFoundError（HTTPException）以
 * str() 包装进 ProxyException.message，故 message 带 "400: " 前缀。
 * @param model - 客户端请求的模型名
 */
function buildAnthropicInvalidModelError(model: string): ApiError {
	return buildInvalidModelError(`400: ${formatInvalidModelMessage(ANTHROPIC_MESSAGES_ROUTE_NAME, model)}`);
}

/**
 * buildUpstreamAttempt 的抛出变体：无可用 deployment 时按模型存在性抛错——
 * 模型不存在抛 400（PY ProxyModelNotFoundError），模型存在但全部署冷却抛
 * ApiError.noDeploymentsAvailable（HTTP 429，Python 风格错误体）。
 * 供 count_tokens / files / batches 等单次转发端点使用。
 * @param router - Router 能力子集
 * @param model - 路由 model 名
 * @param requestApiKey - 客户端请求透传的 api_key（兜底）
 * @param requestAnthropicVersion - 客户端请求透传的 anthropic-version
 * @throws {ApiError} 模型不存在（HTTP 400）或无可用 deployment（HTTP 429）
 */
export function requireUpstreamAttempt(
	router: FallbackRouterFacade,
	model: string,
	requestApiKey?: string,
	requestAnthropicVersion?: string,
): UpstreamAttempt {
	const attempt = buildUpstreamAttempt(router, model, requestApiKey, requestAnthropicVersion);
	if (!attempt) {
		if (!router.hasModel(model)) {
			throw buildAnthropicInvalidModelError(model);
		}
		throw ApiError.noDeploymentsAvailable(model, router.getNoAvailableDeploymentInfo(model));
	}
	return attempt;
}

/**
 * 把 execute 抛出的非 ProviderUpstreamError 异常包装为 APIConnectionError
 * （fetch 网络错误 / 响应 JSON 解析失败等）。APIConnectionError 在冷却判定中豁免
 * （对齐 PY：连接错误触发 fallback 但不计冷却），且错误类别归 TimeoutError。
 * @param err - execute 抛出的原始异常
 */
function normalizeProviderFailure(err: unknown): Error {
	if (err instanceof ProviderUpstreamError) {
		return err;
	}
	const message = err instanceof Error ? err.message : String(err);
	return new APIConnectionError(message);
}

/** Anthropic 上游 fallback 执行过程中回写的统计与共享轨迹。 */
export interface FallbackExecutionStats {
	/** 已进入的 fallback 深度。 */
	fallbackDepth: number;
	/** 原始请求模型及实际 fallback 模型。 */
	fallbackModels?: string[];
	/** 已展开的 alias 解析链快照。 */
	modelResolutionChain?: ModelResolutionChainEntry[];
	/** 请求级共享 alias 解析轨迹。 */
	modelResolutionTrace?: ModelResolutionTraceCollector;
}

/**
 * 带 fallback 链的上游执行：对当前 model 的可用 deployment 逐个直连，
 * 失败（provider 非 2xx / 网络错误）登记冷却后沿 Router fallback 链重试下一跳。
 *
 * 与 RouterExecution 的差异：RouterExecution 在 retry 循环中重复打同一 deployment
 * （num_retries 语义），本函数每个 deployment 只打一次——直连端点没有 retry 语义，
 * 且失败 deployment 未必进入冷却（如 400 非冷却目标），用 attemptedDeploymentKeys
 * 去重防止同组死循环，随后推进 fallback 链。
 * @template T - execute 的返回类型
 * @param router - Router 能力子集
 * @param model - 路由 model 名（fallback 链查表与 no-deployments 错误均以此为准）
 * @param requestApiKey - 客户端请求透传的 api_key（兜底）
 * @param requestAnthropicVersion - 客户端请求透传的 anthropic-version
 * @param execute - 对单个 deployment 执行上游调用；provider 失败必须抛
 * ProviderUpstreamError，其余异常按连接错误处理（均可 fallback）
 * @param fallbackStats - 可选输出参数：回写最终 fallback 跳数
 * （SpendLogs metadata.attempted_retries 数据源），也可携带请求级 alias trace collector
 * @returns execute 的成功结果
 * @throws {ApiError} 链耗尽后抛最后一个 provider 错误（保留其 HTTP 状态码）；
 *   模型不存在抛 400（PY ProxyModelNotFoundError）；
 *   模型存在但全程无可用 deployment 时抛 noDeploymentsAvailable（HTTP 429）
 */
export async function executeWithFallbackChain<T>(
	router: FallbackRouterFacade,
	model: string,
	requestApiKey: string | undefined,
	requestAnthropicVersion: string | undefined,
	execute: (attempt: UpstreamAttempt) => Promise<T>,
	fallbackStats?: FallbackExecutionStats,
): Promise<T> {
	const modelResolutionTrace = fallbackStats?.modelResolutionTrace ?? createModelResolutionTraceCollector();
	const attemptedDeploymentKeys = new Set<string>();
	let currentModel: string | null = model;
	let fallbackDepth = 0;
	const fallbackModels: string[] = [model];
	let lastError: Error | null = null;

	while (currentModel !== null) {
		const resolution = router.resolveModelGroupWithTrace?.(currentModel) ?? {
			inputModel: currentModel,
			resolvedModel: currentModel,
			resolutionPath: [currentModel],
		};
		appendModelResolutionTrace(modelResolutionTrace, fallbackDepth, resolution);
		if (fallbackStats) {
			fallbackStats.fallbackDepth = fallbackDepth;
			fallbackStats.fallbackModels = [...fallbackModels];
			fallbackStats.modelResolutionChain = copyModelResolutionChain(modelResolutionTrace);
		}
		// 同模型组循环：失败 deployment 入冷却后，组内其余健康 deployment 继续承担
		let attempt = buildUpstreamAttempt(router, currentModel, requestApiKey, requestAnthropicVersion);
		while (attempt !== null && !attemptedDeploymentKeys.has(attempt.deploymentKey)) {
			attemptedDeploymentKeys.add(attempt.deploymentKey);
			try {
				const result = await execute(attempt);
				router.recordDeploymentSuccess(attempt.deployment);
				if (fallbackStats) {
					fallbackStats.fallbackDepth = fallbackDepth;
					fallbackStats.fallbackModels = [...fallbackModels];
					fallbackStats.modelResolutionChain = copyModelResolutionChain(modelResolutionTrace);
				}
				return result;
			} catch (err) {
				if (err !== null && typeof err === "object" && "name" in err && err.name === "AbortError") {
					throw err;
				}
				const failure = normalizeProviderFailure(err);
				lastError = failure;
				router.recordDeploymentFailure(attempt.deployment, failure);
				logger.warn("上游 deployment 失败，尝试同组下一 deployment 或 fallback 链", {
					model: currentModel,
					deployment: attempt.deployment.model_name,
					error: failure.message,
				});
				attempt = buildUpstreamAttempt(router, currentModel, requestApiKey, requestAnthropicVersion);
			}
		}
		// 组内耗尽 → 查当前 model 自身 fallback 链的链首（depth 恒为 0，
		// 与 RouterExecution / 流式端点统一；fallbackDepth 仅是跳数计数器）
		fallbackDepth += 1;
		if (fallbackDepth >= router.maxFallbacks) {
			// 对齐 PY max_fallbacks 上限：防环型配置（A→B→A）死循环
			break;
		}
		const fallbackResolution: ModelGroupResolution | null | undefined = router.getNextFallbackWithTrace?.(currentModel, 0);
		if (fallbackResolution) {
			currentModel = fallbackResolution.inputModel;
			fallbackModels.push(fallbackResolution.resolvedModel);
		} else {
			currentModel = router.getNextFallback(currentModel, 0);
			if (currentModel !== null) {
				fallbackModels.push(currentModel);
			}
		}
	}

	if (lastError !== null) {
		const status = lastError instanceof ProviderUpstreamError ? lastError.status : 500;
		throw new ApiError(status, lastError.message);
	}
	// 链耗尽且无任何 provider 错误：模型不存在 → 400（PY ProxyModelNotFoundError）；
	// 模型存在但全部署冷却 → 429 no-deployments
	if (!router.hasModel(model)) {
		throw buildAnthropicInvalidModelError(model);
	}
	throw ApiError.noDeploymentsAvailable(model, router.getNoAvailableDeploymentInfo(model));
}
