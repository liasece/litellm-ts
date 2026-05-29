/**
 * Redis Cooldown Backend
 *
 * DIFF-RT-CB-01: 分布式 cooldown 后端，对齐 PY litellm/router_utils/cooldown_cache.py。
 *
 * 协议（对齐 PY CooldownCache.async_get_active_cooldowns）：
 *   - Key: `litellm:cooldown:{deploymentName}` （与 PY DualCache prefix 风格一致）
 *   - Value: JSON 序列化的 CooldownCacheValue
 *   - TTL: cooldown_time / 1000 秒（与值同步）
 *
 * 设计：依赖注入式 ioredis 客户端（DI-friendly 便于测试 mock）。
 * 不在硬依赖中引入 ioredis — 调用方需要时再注入，避免增加 TS 端的运行时依赖。
 *
 * 评估结论：当前 litellm-ts 单进程运行；多实例部署尚未启用。Backend 接口已就位，
 * 本类作为可选用实现 — 在 router config 中传入即可启用分布式 cooldown 同步。
 */

import type { CooldownCacheBackend, CooldownCacheValue } from "./CooldownCacheTypes";

/**
 * ioredis 客户端的最小子集，避免硬依赖 ioredis 类型。
 * 调用方传入时声明 `import type Redis from "ioredis"; new RedisCooldownBackend(new Redis(url))`。
 */
export interface RedisLike {
	/**
	 *
	 */
	set(key: string, value: string, ...args: unknown[]): Promise<unknown> | unknown;
	/**
	 *
	 */
	get(key: string): Promise<string | null> | string | null;
	/**
	 *
	 */
	del(key: string): Promise<unknown> | unknown;
	/**
	 *
	 */
	expire(key: string, seconds: number): Promise<unknown> | unknown;
}

/**
 * 构造一个 Redis cooldown backend。
 * @param client - ioredis 客户端
 * @param keyPrefix - Redis key 前缀，默认 `litellm:cooldown:`
 */
export class RedisCooldownBackend implements CooldownCacheBackend {
	private readonly _client: RedisLike;
	private readonly _keyPrefix: string;

	constructor(client: RedisLike, keyPrefix = "litellm:cooldown:") {
		this._client = client;
		this._keyPrefix = keyPrefix;
	}

	private _key(deploymentName: string): string {
		return `${this._keyPrefix}${deploymentName}`;
	}

	/**
	 * 写入冷却记录。TTL = cooldown_time / 1000 秒（与 PY INCR/EXPIRE 同步语义）。
	 * @param deploymentName
	 * @param value
	 */
	async setCooldown(deploymentName: string, value: CooldownCacheValue): Promise<void> {
		const key = this._key(deploymentName);
		const ttlSec = Math.max(1, Math.ceil(value.cooldown_time / 1000));
		const payload = JSON.stringify(value);
		try {
			await this._client.set(key, payload, "EX", ttlSec);
		} catch (err) {
			// 远端写入失败不影响主路径（CooldownManager 已 best-effort swallow）
			throw new Error(`RedisCooldownBackend.setCooldown failed: ${(err as Error).message}`);
		}
	}

	/**
	 * 读取冷却记录。本地 CooldownManager 会校验 timestamp + cooldown_time 决定是否过期。
	 * @param deploymentName
	 */
	async getCooldown(deploymentName: string): Promise<CooldownCacheValue | undefined> {
		const raw = await this._client.get(this._key(deploymentName));
		if (raw === null || raw === undefined) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as CooldownCacheValue;
			return parsed;
		} catch {
			return undefined;
		}
	}

	/**
	 * 清理冷却记录。
	 * @param deploymentName
	 */
	async deleteCooldown(deploymentName: string): Promise<void> {
		try {
			await this._client.del(this._key(deploymentName));
		} catch (err) {
			throw new Error(`RedisCooldownBackend.deleteCooldown failed: ${(err as Error).message}`);
		}
	}
}
