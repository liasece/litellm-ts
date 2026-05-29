/**
 * Cooldown 远端同步 helper（DualCache 风格）
 *
 * 从 CooldownManager 拆出 backend (Redis) 同步逻辑，便于：
 * - 单元测试以纯函数方式验证 read/hydrate 行为
 * - 控制 CooldownManager.ts 行数（不让 backend 逻辑膨胀主类）
 *
 * 设计：所有 backend 操作都是 best-effort，远端异常一律吞掉，
 * 不影响 CooldownManager 主路径决策。
 */

import type { CooldownCacheBackend, CooldownCacheValue } from "./CooldownCacheTypes";

/**
 * 异步从 backend 读取单个 deployment 的冷却条目。
 *
 * 语义：
 * - 拉到有效条目 → 返回 value（调用方负责写入本地）
 * - 拉到过期条目 → fire-and-forget 删远端，返回 undefined
 * - 拉不到 / backend 抛错 → 返回 undefined
 * @param backend - 远端 backend（如 RedisCooldownBackend）
 * @param deploymentName - deployment 标识
 * @param now - 当前时间戳（ms），缺省 Date.now()。注入便于测试。
 */
export async function readActiveFromBackend(
	backend: CooldownCacheBackend,
	deploymentName: string,
	now: number = Date.now(),
): Promise<CooldownCacheValue | undefined> {
	try {
		const remote = await Promise.resolve(backend.getCooldown(deploymentName));
		if (!remote) {
			return undefined;
		}
		const expiry = remote.timestamp + remote.cooldown_time;
		if (now > expiry) {
			// 远端条目已过期，best-effort 清理
			void Promise.resolve(backend.deleteCooldown(deploymentName)).catch(() => {
				/* ignore */
			});
			return undefined;
		}
		return remote;
	} catch {
		// backend 失败不影响主路径
		return undefined;
	}
}

/**
 * 批量从 backend 拉取一组 deployment 的有效 cooldown 条目，warm 调用方本地缓存。
 *
 * 已经在本地（`localHasCooldown` 命中）的 deployment 会被跳过，避免无谓远端 round trip。
 * 返回拉到的 `{ deploymentName -> value }` 字典；调用方决定如何写入本地缓存。
 * 对齐 PY `CooldownCache.async_get_active_cooldowns(model_ids)`。
 * @param backend - 远端 backend
 * @param deploymentNames - 要查询的 deployment 列表
 * @param localHasCooldown - 判定本地是否已有 cooldown 的回调；返回 true 时跳过远端查询
 * @param now - 当前时间戳（ms），便于测试
 */
export async function hydrateActiveFromBackend(
	backend: CooldownCacheBackend,
	deploymentNames: string[],
	localHasCooldown: (deploymentName: string) => boolean,
	now: number = Date.now(),
): Promise<Map<string, CooldownCacheValue>> {
	const hydrated = new Map<string, CooldownCacheValue>();
	await Promise.all(
		deploymentNames.map(async (name) => {
			if (localHasCooldown(name)) {
				return;
			}
			const value = await readActiveFromBackend(backend, name, now);
			if (value !== undefined) {
				hydrated.set(name, value);
			}
		}),
	);
	return hydrated;
}
