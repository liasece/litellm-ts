/**
 * RouterRetryPolicy — 重试策略 + backoff 计算辅助
 *
 * 抽离 Router 中的：
 *   - _shouldRetry / _shouldRetryThisError（PY should_retry_this_error 语义）
 *   - _getRetryPolicyOverride（按错误类型从 policy 派生重试次数）
 *   - _parseRetryAfterSeconds（Retry-After header 解析）
 *   - _calculateBackoff / _timeToSleepBeforeRetry（PY _calculate_retry_after 语义）
 *
 * 让 Router.ts 主类不再承载这些细节。
 */

import type { Deployment, RetryPolicy, RouterConfig } from "../types/router";
import {
	AuthenticationError,
	APIConnectionError,
	TimeoutError,
	RateLimitError,
	ContentPolicyViolationError,
	BadRequestError,
	ContextWindowExceededError,
	NotFoundError,
} from "./RouterErrors";
import type { FallbackHandler } from "./FallbackHandler";

/**
 * PY 简单状态码白名单：408/409/429 + 5xx 可重试。
 * @param statusCode
 */
export function shouldRetryStatusCode(statusCode: number): boolean {
	if (statusCode === 408 || statusCode === 409 || statusCode === 429) {
		return true;
	}
	return statusCode >= 500;
}

/**
 * 对齐 PY should_retry_this_error (router.py:5798-5868)。
 *
 * GAP 5: 严格按 PY 顺序排列分支：
 *   1. CW + cw_fallbacks→raise (不重试，交给 fallback 链)
 *   2. CP + cp_fallbacks→raise
 *   3. status_code not in _should_retry && status_code not in (401,403)→raise
 *   4. NotFoundError (404)→raise
 *   5. RateLimitError (429) 无健康部署 + 有 fallbacks→raise
 *   6. healthy_deployments<=0→raise
 *   7. AuthenticationError + num_all_deployments<=1→raise
 *   8. else return True
 *
 * DIFF-001: 不应重试时通过 `throw categorizedError` 让上层 catch 保留真实异常类型。
 * @param statusCode
 * @param model
 * @param categorizedError
 * @param fallbackHandler
 * @param allDeploymentsCount
 * @param healthyDeploymentsCount
 * @throws {Error} 不应重试时抛 categorizedError 让上层 catch 保留真实异常类型
 */
export function shouldRetryThisError(
	statusCode: number,
	model: string,
	categorizedError: Error | undefined,
	fallbackHandler: FallbackHandler,
	allDeploymentsCount: number,
	healthyDeploymentsCount: number,
): boolean {
	const raiseError = (): never => {
		throw categorizedError ?? new Error(`HTTP ${statusCode}`);
	};
	// 1. CW + cw_fallbacks → raise
	if (categorizedError instanceof ContextWindowExceededError) {
		const cwFallback = fallbackHandler.getContextWindowFallbackChain(model);
		if (cwFallback.length > 0) {
			raiseError();
		}
		raiseError();
	}
	// 2. CP + cp_fallbacks → raise
	if (categorizedError instanceof ContentPolicyViolationError) {
		const cpFallback = fallbackHandler.getContentPolicyFallbackChain(model);
		if (cpFallback.length > 0) {
			raiseError();
		}
		raiseError();
	}
	// 3. status_code not in _should_retry && not in (401,403) → raise
	if (!shouldRetryStatusCode(statusCode) && statusCode !== 401 && statusCode !== 403) {
		raiseError();
	}
	// 4. NotFoundError (404) → raise
	if (categorizedError instanceof NotFoundError || statusCode === 404) {
		raiseError();
	}
	// 5. RateLimitError (429) 无健康部署 + 有 fallbacks → raise
	if (statusCode === 429 || categorizedError instanceof RateLimitError) {
		if (healthyDeploymentsCount === 0) {
			const hasFallbacks = fallbackHandler.getFallbackChain(model).length > 0;
			if (hasFallbacks) {
				raiseError();
			}
		}
		return true;
	}
	// 6. healthy=0 → raise（必须先于 Auth 检查）
	if (healthyDeploymentsCount === 0) {
		raiseError();
	}
	// 7. AuthenticationError + num_all_deployments<=1 → raise
	if (categorizedError instanceof AuthenticationError || statusCode === 401 || statusCode === 403) {
		if (allDeploymentsCount <= 1) {
			raiseError();
		}
		return true;
	}
	// 8. 408/409/5xx → true
	if (statusCode === 408 || statusCode === 409) {
		return true;
	}
	if (statusCode >= 500) {
		return true;
	}
	raiseError();
	return false;
}

/**
 * 根据错误类型从 retry_policy / model_group_retry_policy 获取覆写的重试次数
 * @param exception - 错误对象（PY 第一个参数是 exception）
 * @param retryPolicy - 顶层 retry_policy
 * @param modelGroup - 模型组名
 * @param modelGroupRetryPolicy - 按模型组的 retry_policy 覆盖
 * @param overridePolicy - per-request policy override（兼容旧 TS 调用方式）
 */
export function getRetryPolicyOverride(
	exception: Error,
	retryPolicy: RetryPolicy | undefined,
	modelGroup: string,
	modelGroupRetryPolicy: Record<string, RetryPolicy> | undefined,
	overridePolicy?: Record<string, RetryPolicy>,
): number | undefined {
	// PY: priority is per-request override > model_group_retry_policy[model_group] > retry_policy
	const policy = overridePolicy?.[modelGroup] ?? modelGroupRetryPolicy?.[modelGroup] ?? retryPolicy;
	if (!policy) {
		return undefined;
	}

	// ContextWindowExceededError 必须最先检查（继承 BadRequestError）
	if (exception instanceof ContextWindowExceededError) {
		return undefined;
	}
	if (exception instanceof AuthenticationError) {
		return policy.AuthenticationErrorRetries ?? undefined;
	}
	if (exception instanceof APIConnectionError || exception instanceof TimeoutError) {
		return policy.TimeoutErrorRetries ?? undefined;
	}
	if (exception instanceof RateLimitError) {
		return policy.RateLimitErrorRetries ?? undefined;
	}
	if (exception instanceof ContentPolicyViolationError) {
		return policy.ContentPolicyViolationErrorRetries ?? undefined;
	}
	if (exception instanceof BadRequestError) {
		return policy.BadRequestErrorRetries ?? undefined;
	}
	return undefined;
}

/**
 * Parse Retry-After header value into seconds.
 * 支持整数秒与 RFC 5322/7231 HTTP-date。60s 上限（与 PY 一致）。
 * @param header - Retry-After header value
 */
export function parseRetryAfterSeconds(header: string): number | null {
	const seconds = parseInt(header, 10);
	if (!isNaN(seconds) && seconds > 0) {
		if (seconds <= 60) {
			return seconds;
		}
		return null;
	}
	const parsed = Date.parse(header);
	if (!isNaN(parsed)) {
		const diff = (parsed - Date.now()) / 1000;
		if (diff > 0 && diff <= 60) {
			return diff;
		}
	}
	return null;
}

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8000;

/**
 * 计算退避秒数。
 * 严格按 PY `_calculate_retry_after` 顺序：
 *   1) sleep = INITIAL_RETRY_DELAY * pow(2, num_retries)
 *   2) sleep = max(sleep, min_timeout)        ← 提升下限
 *   3) sleep = min(sleep, MAX_RETRY_DELAY)    ← 施加硬上限
 *   4) return sleep + JITTER*random()
 * @param numRetries - 已重试次数（0-based）
 * @param minTimeoutMs - retry_after 转换的毫秒（退避下限）
 * @param retryAfterHeader - 可选 Retry-After header，命中时优先返回
 */
export function calculateBackoff(numRetries: number, minTimeoutMs: number, retryAfterHeader?: string): number {
	if (retryAfterHeader) {
		const seconds = parseRetryAfterSeconds(retryAfterHeader);
		if (seconds !== null && seconds <= 60) {
			return seconds + Math.random() * 0.75;
		}
	}
	let baseMs = INITIAL_RETRY_DELAY_MS * 2 ** numRetries;
	if (minTimeoutMs > 0) {
		baseMs = Math.max(baseMs, minTimeoutMs);
	}
	baseMs = Math.min(baseMs, MAX_RETRY_DELAY_MS);
	const jitter = Math.random() * 750;
	return (baseMs + jitter) / 1000;
}

/**
 * 对齐 PY _time_to_sleep_before_retry (router.py:5916-5963)。
 * GAP 1: 同时从 error 对象提取 Retry-After。
 * GAP 1 (单部署豁免): 单部署跳过 healthy>0 早退，直接走 backoff。
 * @param args - 见结构体字段
 * @param args.error - 触发重试的异常
 * @param args.numRetries - 已重试次数
 * @param args.healthyDeployments - 同组 healthy 部署列表
 * @param args.allDeployments - 全部署列表（用于单部署豁免）
 * @param args.minTimeoutMs - retry_after 毫秒
 * @param args.retryAfterHeader - 上层 response 头部抽取的 Retry-After
 * @param args.extractFromError - 从 Error 抽取 Retry-After 的回调
 */
export function timeToSleepBeforeRetry(args: {
	error: Error | undefined;
	numRetries: number;
	healthyDeployments: Deployment[];
	allDeployments: Deployment[];
	minTimeoutMs: number;
	retryAfterHeader: string | undefined;
	extractFromError: (err: Error) => string | undefined;
}): number {
	const { error, numRetries, healthyDeployments, allDeployments, retryAfterHeader, extractFromError } = args;
	const isSingleDeployment = allDeployments.length === 1;
	if (!isSingleDeployment && healthyDeployments.length > 0) {
		return 0;
	}
	const effectiveRetryAfter = retryAfterHeader ?? (error ? extractFromError(error) : undefined);
	return calculateBackoff(numRetries, 0, effectiveRetryAfter);
}

/**
 * 给定 RouterConfig 抽取 effective minTimeoutMs（retry_after * 1000）。
 * @param config
 */
export function minTimeoutMsFromConfig(config: RouterConfig): number {
	return (config.retry_after ?? 0) * 1000;
}
