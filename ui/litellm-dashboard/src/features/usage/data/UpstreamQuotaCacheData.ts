import { z } from "zod";
import {
	accountQuotaSchema,
	builtInQuotaAccountSchema,
	upstreamAccountSchema,
	type AccountQuota,
	type BuiltInQuotaAccount,
	type UpstreamAccount,
} from "../api/UpstreamQuotaApi";

/**
 * 上游账号额度的浏览器缓存。
 *
 * 页面打开时先用上次成功的快照填表，再在后台请求真实额度；这样 9 个账号逐个查询
 * 的等待不会体现成一片空白。缓存只承担“先显示”，从不替代请求结果：请求成功就整体
 * 覆盖并重写快照，请求失败保留旧数值并在行上写明真实错误。
 */
const STORAGE_KEY = "upstreamAccountQuotaCache";
/** 快照结构变化时递增：旧版本整条丢弃，避免用已经不符合接口的数据铺表。 */
const CACHE_VERSION = 2;
/** 超过一天的快照不再展示：剩余额度和重置时间都已失真，不如直接等真实请求。 */
export const UPSTREAM_QUOTA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const cacheSchema = z.object({
	version: z.literal(CACHE_VERSION),
	savedAt: z.number().finite(),
	accounts: z.array(upstreamAccountSchema),
	providers: z.array(builtInQuotaAccountSchema),
	quotas: z.record(z.string(), accountQuotaSchema),
});

export interface UpstreamQuotaSnapshot {
	savedAt: number;
	accounts: UpstreamAccount[];
	providers: BuiltInQuotaAccount[];
	quotas: Record<string, AccountQuota>;
}

/** 只需要读写删除三个方法，便于测试注入内存实现。 */
export type UpstreamQuotaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 解析本地快照：版本不符、字段缺失、损坏 JSON、超过保留期都整条丢弃。 */
export function parseUpstreamQuotaCache(raw: string | null, now = Date.now()): UpstreamQuotaSnapshot | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const result = cacheSchema.safeParse(parsed);
	if (!result.success) return null;
	// 未来的时间戳同样不可信（比如系统时钟被改过），超过保留期就不展示。
	if (now - result.data.savedAt > UPSTREAM_QUOTA_CACHE_MAX_AGE_MS || result.data.savedAt - now > UPSTREAM_QUOTA_CACHE_MAX_AGE_MS) {
		return null;
	}
	return {
		savedAt: result.data.savedAt,
		accounts: result.data.accounts,
		providers: result.data.providers,
		quotas: result.data.quotas,
	};
}

/** 读取缓存；浏览器禁用存储或读写抛错时按“没有缓存”处理。 */
export function readUpstreamQuotaCache(storage: UpstreamQuotaStorage | null | undefined, now = Date.now()): UpstreamQuotaSnapshot | null {
	if (!storage) return null;
	try {
		return parseUpstreamQuotaCache(storage.getItem(STORAGE_KEY), now);
	} catch {
		return null;
	}
}

/** 写入快照；存储满额等失败不阻塞页面，下次请求成功会再写一次。 */
export function writeUpstreamQuotaCache(
	storage: UpstreamQuotaStorage | null | undefined,
	snapshot: Omit<UpstreamQuotaSnapshot, "savedAt">,
	now = Date.now(),
): void {
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify({ version: CACHE_VERSION, savedAt: now, ...snapshot }));
	} catch {
		/* 存储不可用时只是少了缓存，不影响本次显示。 */
	}
}

export function clearUpstreamQuotaCache(storage: UpstreamQuotaStorage | null | undefined): void {
	if (!storage) return;
	try {
		storage.removeItem(STORAGE_KEY);
	} catch {
		/* 同上：失败无需上报。 */
	}
}

/** 默认使用浏览器 localStorage；SSR 或禁用存储时返回 null。 */
export function resolveUpstreamQuotaStorage(): UpstreamQuotaStorage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}
