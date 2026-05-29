/**
 * RouterTestDelegates — Router 内部逻辑的纯函数测试入口
 *
 * 路由主类 Router 出于封装考虑，私有方法不直接暴露给测试。
 * 本模块把 _shouldRetryThisError / _timeToSleepBeforeRetry / _getRetryPolicyOverride /
 * _parseRetryAfterSeconds / _getDeploymentKey / _countSameGroupDeployments / _calculateBackoff
 * 等内部 helper 暴露为同等的纯函数（接收相同输入参数并返回相同结果），供 Router.*.test.ts
 * 直接调用。
 *
 * 真实生产路径仍走 RouterExecution.executeWithFallback + RouterModelGroupCache，
 * 这些 delegate 仅作为"逻辑等价"的测试入口；不替代生产代码。
 */

import type { Deployment, RetryPolicy } from "../types/router";
import { shouldRetryThisError, calculateBackoff, getRetryPolicyOverride, parseRetryAfterSeconds } from "./RouterRetryPolicy";
import { getDeploymentKey } from "./RouterModelGroupCache";
import { ModelGroupCache } from "./RouterModelGroupCache";
import { extractRetryAfterFromError } from "./RouterExecutor";
import type { FallbackHandler } from "./FallbackHandler";

/**
 * 对齐 Router._shouldRetryThisError
 * @param statusCode
 * @param model
 * @param fallbackHandler
 * @param totalDeploymentsCount
 * @param healthyDeploymentsCount
 * @param categorizedError
 */
export function shouldRetryThisErrorDelegate(
	statusCode: number,
	model: string,
	fallbackHandler: FallbackHandler,
	totalDeploymentsCount: number,
	healthyDeploymentsCount: number,
	categorizedError?: Error,
): boolean {
	return shouldRetryThisError(statusCode, model, categorizedError, fallbackHandler, totalDeploymentsCount, healthyDeploymentsCount);
}

/**
 * 对齐 Router._timeToSleepBeforeRetry
 * @param args
 */
export function timeToSleepBeforeRetryDelegate(args: {
	error: Error | undefined;
	_remainingRetries: number;
	numRetries: number;
	healthyDeployments: Deployment[];
	allDeployments: Deployment[];
	retryAfterHeader: string | undefined;
	retryAfterSec: number;
}): number {
	const { error, numRetries, healthyDeployments, allDeployments, retryAfterHeader, retryAfterSec } = args;
	const isSingleDeployment = allDeployments.length === 1;
	if (!isSingleDeployment && healthyDeployments.length > 0) {
		return 0;
	}
	const effectiveRetryAfter = retryAfterHeader ?? (error ? extractRetryAfterFromError(error) : undefined);
	return calculateBackoff(numRetries, retryAfterSec * 1000, effectiveRetryAfter);
}

/**
 * 对齐 Router._getRetryPolicyOverride
 * @param exception
 * @param retryPolicy
 * @param modelGroup
 * @param modelGroupRetryPolicy
 * @param overridePolicy
 */
export function getRetryPolicyOverrideDelegate(
	exception: Error,
	retryPolicy: RetryPolicy | undefined,
	modelGroup: string,
	modelGroupRetryPolicy: Record<string, RetryPolicy> | undefined,
	overridePolicy?: Record<string, RetryPolicy>,
): number | undefined {
	return getRetryPolicyOverride(exception, retryPolicy, modelGroup, modelGroupRetryPolicy, overridePolicy);
}

/**
 * 对齐 Router._parseRetryAfterSeconds
 * @param header
 */
export function parseRetryAfterSecondsDelegate(header: string): number | null {
	return parseRetryAfterSeconds(header);
}

/**
 * 对齐 Router._getDeploymentKey
 * @param deployment
 */
export function getDeploymentKeyDelegate(deployment: Deployment): string {
	return getDeploymentKey(deployment);
}

/**
 * 对齐 Router._countSameGroupDeployments
 * @param deployment
 * @param allDeployments
 */
export function countSameGroupDeploymentsDelegate(deployment: Deployment, allDeployments: Deployment[]): number {
	const cache = new ModelGroupCache();
	return cache.countSameGroup(deployment, allDeployments);
}

/**
 * 对齐 Router._calculateBackoff
 * @param numRetries
 * @param retryAfterSec
 * @param retryAfterHeader
 */
export function calculateBackoffDelegate(numRetries: number, retryAfterSec: number, retryAfterHeader?: string): number {
	return calculateBackoff(numRetries, retryAfterSec * 1000, retryAfterHeader);
}
