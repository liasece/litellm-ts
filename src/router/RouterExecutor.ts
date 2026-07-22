/**
 * RouterExecutor — _executeWithFallback 错误分类 / cooldown 决策 helper
 *
 * 抽离 Router 中 _executeWithFallback catch 路径的错误分类与 cooldown/fallback 决策：
 *   - castExceptionStatusToInt：把异常 message 中的状态码字符串解析为 int
 *   - categorizeErrorForCooldown：把 error 实例分到 CooldownManager 的类别字符串
 *   - categorizeProviderError：把上游 status code + body 派发为 litellm 异常类型
 *   - extractRetryAfterFromResponse / extractRetryAfterFromError：Retry-After 头/对象抽取
 *   - checkContentFilterOn200：200 响应中的 content_filter finish_reason 检测
 *   - buildCooldownDecision：根据错误与配置构造冷却持续时间
 *
 * 让 Router.ts 主类不再承载这些细节。
 */

import type { Deployment } from "../types/router";
import type { FallbackHandler } from "./FallbackHandler";
import type { CooldownManager } from "./CooldownManager";
import {
	ContextWindowExceededError,
	ContentPolicyViolationError,
	TimeoutError,
	RateLimitError,
	AuthenticationError,
	NotFoundError,
	InternalServerError,
} from "./RouterErrors";
import { logger } from "../core/utils/logger";
import { parseRetryAfterSeconds } from "./RouterRetryPolicy";
import { getDeploymentKey } from "./RouterModelGroupCache";
import { categorizeErrorForCooldown } from "./CooldownErrorCategory";

/**
 * PY: cast_exception_status_to_int (cooldown_handlers.py:450-459)
 * 处理 str/int 两种类型，失败时返回 500。
 * @param messageOrStatus
 */
export function castExceptionStatusToInt(messageOrStatus: string | number | undefined): number {
	if (typeof messageOrStatus === "number") {
		return messageOrStatus;
	}
	if (typeof messageOrStatus === "string") {
		const match = /\b(\d{3})\b/.exec(messageOrStatus);
		if (match) {
			return parseInt(match[1] as string, 10);
		}
	}
	return 500;
}

/**
 * 对齐 PY isinstance 检查 + 透传原始异常类型。
 * 401/403 → AuthenticationError, 404 → NotFoundError, 408 → TimeoutError,
 * 429 → RateLimitError, 5xx → 包装为 Error。
 * @param statusCode
 * @param bodyStr
 */
export function categorizeProviderError(statusCode: number, bodyStr: string): Error {
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

	if (statusCode === 401 || statusCode === 403) {
		return new AuthenticationError(bodyStr);
	}
	if (statusCode === 404) {
		return new NotFoundError(bodyStr);
	}
	if (statusCode === 408) {
		return new TimeoutError(bodyStr);
	}
	if (statusCode === 429 || lower.includes("rate limit") || lower.includes("rate_limit")) {
		return new RateLimitError(bodyStr);
	}
	if (statusCode >= 500) {
		return new InternalServerError(bodyStr);
	}
	return new Error(bodyStr);
}

/**
 * 从 Response 中提取 Retry-After header（若存在）。
 * @param response
 */
export function extractRetryAfterFromResponse(response: Response): string | undefined {
	return response.headers?.get("Retry-After") ?? undefined;
}

/**
 * 从 Error 对象抽取 Retry-After（message / response_headers / litellm_response_headers / retry_after）。
 * @param error
 */
export function extractRetryAfterFromError(error: Error): string | undefined {
	const match = /Retry-After:\s*(\d+)/i.exec(error.message);
	if (match?.[1]) {
		return match[1];
	}
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
 * 检查 200 响应中是否包含 content_filter finish_reason（GAP #11）。
 * @param body
 * @param model
 * @param modelName
 * @param fallbackHandler
 * @throws {ContentPolicyViolationError} 当检测到 content_filter 时抛出
 */
export function checkContentFilterOn200Response(body: unknown, model: string, modelName: string, fallbackHandler: FallbackHandler): void {
	const cpFallbackChain = fallbackHandler.getContentPolicyFallbackChain(model);
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
 * 冷却决策结果，由 `buildCooldownDecision` 返回：
 *   - shouldCooldown：是否应当进入冷却
 *   - cooldownDurationMs：冷却持续时间（毫秒），与 cooldownTime 配置优先级一致
 *   - statusCode：触发冷却的 HTTP 状态码（用于回调/diagnostics）
 */
export interface CooldownDecision {
	/** 是否应当进入冷却（false 时 cooldownDurationMs=0） */
	shouldCooldown: boolean;
	/** 冷却持续时间（毫秒），未触发时为 0 */
	cooldownDurationMs: number;
	/** 触发冷却的 HTTP 状态码（用于回调/diagnostics） */
	statusCode: number;
}

/**
 * 冷却决策：聚合 status code / same group count / errorCategory → CooldownManager 判定。
 * 命中时给出最终 cooldown 持续时间（按 deployCooldown > retryAfter > default 顺序）。
 * @param deployment
 * @param error
 * @param sameGroupCount
 * @param retryAfterHeader
 * @param defaultCooldownTimeMs
 * @param cooldownManager
 */
export function buildCooldownDecision(
	deployment: Deployment,
	error: Error,
	sameGroupCount: number,
	retryAfterHeader: string | undefined,
	defaultCooldownTimeMs: number,
	cooldownManager: CooldownManager,
): CooldownDecision {
	const exceptionStrForCooldown = error.name || error.message;
	const errorCategory = categorizeErrorForCooldown(error);
	const statusCode = castExceptionStatusToInt(error.message);
	const shouldCooldown = cooldownManager.isCooldownRequired(
		getDeploymentKey(deployment),
		statusCode,
		exceptionStrForCooldown,
		sameGroupCount,
		errorCategory,
		error,
		deployment.litellm_params.cooldown_allowed_fails,
	);
	if (!shouldCooldown) {
		return { shouldCooldown: false, cooldownDurationMs: 0, statusCode: statusCode };
	}
	const deployCooldown = deployment.litellm_params.cooldown_time ? deployment.litellm_params.cooldown_time * 1000 : undefined;
	const effectiveRetryAfter = retryAfterHeader ?? extractRetryAfterFromError(error);
	const retryAfterSec = effectiveRetryAfter ? (parseRetryAfterSeconds(effectiveRetryAfter) ?? 0) : 0;
	const retryCooldown = retryAfterSec > 0 ? retryAfterSec * 1000 : undefined;
	const cooldownDurationMs = deployCooldown ?? retryCooldown ?? defaultCooldownTimeMs;
	return { shouldCooldown: true, cooldownDurationMs: cooldownDurationMs, statusCode: statusCode };
}
