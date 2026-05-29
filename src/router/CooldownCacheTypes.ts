/**
 * Cooldown 缓存契约：value 与 backend 接口
 *
 * 从 CooldownManager 抽出，避免 CooldownManager ↔ CooldownRedisSync 循环依赖
 * （RedisSync helper 只依赖契约，不依赖 manager 本身）。
 *
 * 对齐 PY DualCache（内存 + Redis）多实例 cooldown 同步语义。
 */

/**
 * GAP 10: 对齐 PY `CooldownCacheValue` (cooldown_cache.py:23-30)。
 * PY DualCache 写入 exception_received/status_code/timestamp/cooldown_time 四元组，
 * 用于跨进程跨实例同步 (Redis) 和调试信息保留 (status_code, exception)。
 */
export interface CooldownCacheValue {
	/** 错误消息或异常字符串（PY: exception_received） */
	exception_received: string;
	/** 触发冷却的 HTTP 状态码（PY: status_code） */
	status_code: number;
	/** 冷却开始的 epoch 毫秒（PY: timestamp） */
	timestamp: number;
	/** 冷却持续时间（毫秒）（PY: cooldown_time） */
	cooldown_time: number;
}

/**
 * GAP 10: 可选的分布式缓存后端接口，对齐 PY DualCache（内存 + Redis）。
 * 实现该接口的对象可让 CooldownManager 在多实例间共享冷却状态。
 * 接口刻意采用异步签名以支持 Redis 客户端；非必填，缺省走内存 Map。
 */
export interface CooldownCacheBackend {
	/** 异步写入冷却记录，PY: cache.async_set_cache(key, value, ttl) */
	setCooldown(deploymentName: string, value: CooldownCacheValue): Promise<void> | void;
	/** 异步读取冷却记录，PY: cache.async_get_cache(key) */
	getCooldown(deploymentName: string): Promise<CooldownCacheValue | undefined> | CooldownCacheValue | undefined;
	/** 异步清理冷却记录，PY: cache.async_delete_cache(key) */
	deleteCooldown(deploymentName: string): Promise<void> | void;
}
