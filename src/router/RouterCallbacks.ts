/**
 * RouterCallbacks — 路由器执行生命周期回调辅助方法
 *
 * 把 Router._invokeRouterCallback 抽到独立 helper，让 Router.ts 主类更精简。
 * 对齐 PY router.callbacks 的 fail-safe 语义：异常被吞避免影响主路径。
 */

import type { Deployment, RouterCallbacks } from "../types/router";
import { logger } from "../core/utils/logger";

/**
 * DIFF-RT-CALLBACKS-01: 安全执行 router 回调（异常被吞，避免影响主路径）。
 * 对齐 PY router.callbacks 的 fail-safe 语义。
 * @param callbacks - 回调注册表（PY router.callbacks）
 * @param kind - 回调类型
 * @param deployment - 命中的 deployment
 * @param args - 透传参数
 */
export function invokeRouterCallback(
	callbacks: RouterCallbacks | undefined,
	kind: keyof RouterCallbacks,
	deployment: Deployment,
	...args: unknown[]
): void {
	const cb = callbacks?.[kind];
	if (typeof cb !== "function") {
		return;
	}
	try {
		(cb as (...a: unknown[]) => void)(deployment, ...args);
	} catch (err) {
		logger.warn(`router callback ${String(kind)} failed: ${(err as Error).message}`);
	}
}
