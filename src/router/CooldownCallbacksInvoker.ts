/**
 * CooldownCallbacksInvoker — 冷却事件回调派发 helper
 *
 * 抽离自 CooldownManager.markFailed 的回调派发块，让主类保持简洁。
 * 同步直接调用；异步走 fire-and-forget；异常被吞不影响主路径（对齐 PY 行为）。
 */

import type { CooldownCallback } from "./CooldownCallbacks";

/**
 * DIFF-RT-01 / DIFF-014: 执行所有注册的冷却事件回调
 * @param logger
 * @param callbacks
 * @param deploymentId
 * @param cooldownDurationMs
 * @param statusCode
 * @param exceptionReceived
 */
export function invokeCooldownCallbacks(
	logger: { warn: (msg: string) => void },
	callbacks: readonly CooldownCallback[],
	deploymentId: string,
	cooldownDurationMs: number,
	statusCode: number,
	exceptionReceived: string,
): void {
	for (const cb of callbacks) {
		try {
			const ret = cb(deploymentId, cooldownDurationMs, statusCode, exceptionReceived);
			if (ret && typeof (ret as Promise<unknown>).then === "function") {
				(ret as Promise<unknown>).catch((err: unknown) => {
					logger.warn(`async cooldown callback failed for ${deploymentId}: ${(err as Error).message}`);
				});
			}
		} catch (err) {
			logger.warn(`cooldown callback failed for ${deploymentId}: ${(err as Error).message}`);
		}
	}
}
