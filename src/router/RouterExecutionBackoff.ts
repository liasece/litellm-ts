/**
 * RouterExecution backoff helper —— 单独负责重试前的睡眠秒数计算。
 *
 * 把 RouterExecution.ts 中的 computeSleepBeforeRetry 抽离出来，避免主文件
 * 同时承担 fallback 派发 + 主循环 + backoff 三种职责。无循环依赖：本模块
 * 仅依赖 RouterRetryPolicy.calculateBackoff 和 router types。
 */

import type { Deployment } from "../types/router";
import { calculateBackoff } from "./RouterRetryPolicy";

/**
 * 计算 backoff 秒数（提取以复用 _timeToSleepBeforeRetry 逻辑）。
 * @param args - 见结构体字段
 * @param args.error - 触发重试的异常
 * @param args.numRetries - 已重试次数
 * @param args.healthyDeployments - 同组 healthy 部署列表
 * @param args.allDeployments - 全部署列表
 * @param args.retryAfterHeader - 上层 response 头部抽取的 Retry-After
 * @param args.extractFromError - 从 Error 抽取 Retry-After 的回调
 * @param args.cooldownTimeMs - min_timeout 毫秒
 */
export function computeSleepBeforeRetry(args: {
	error: Error | undefined;
	numRetries: number;
	healthyDeployments: Deployment[];
	allDeployments: Deployment[];
	retryAfterHeader: string | undefined;
	extractFromError: (err: Error) => string | undefined;
	cooldownTimeMs: number;
}): number {
	const { error, numRetries, healthyDeployments, allDeployments, retryAfterHeader, extractFromError, cooldownTimeMs } = args;
	const isSingleDeployment = allDeployments.length === 1;
	if (!isSingleDeployment && healthyDeployments.length > 0) {
		return 0;
	}
	const effectiveRetryAfter = retryAfterHeader ?? (error ? extractFromError(error) : undefined);
	return calculateBackoff(numRetries, cooldownTimeMs, effectiveRetryAfter);
}
