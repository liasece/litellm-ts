/**
 * 订阅账号额度可用性（进程内）。
 *
 * 调度器原先只认识「请求失败后冷却」，代价是每次重新发现空账号都要先真实失败一次：
 * 2026-11-19 生产上 CommandCode 周额度耗尽被上游用 429 返回，被当成普通限流只冷却
 * 30 秒，于是每个请求都先撞一次空账号再换号，TTFT p90 到 30~65 秒。
 *
 * 这里把「额度已经用尽」当作账号属性而不是请求结果：额度快照（额度接口）与上游错误
 * （Reset 时间写在错误文案里）都写入同一份状态，调度时直接跳过，直到该账号的重置时间。
 *
 * 三条安全边界：
 * - 快照拉取失败不等于没额度，失败不动已有状态；
 * - 只有「确定用尽且重置时间在未来」才算不可用，缺数据的窗口一律视为可用；
 * - 状态有上限时长（防止上游给出离谱的重置时间把账号永久拉黑），并且调度器在全部
 *   账号都被额度挡住时会兜底放行，避免额度接口抖动直接打挂整个模型。
 */

import type { SubscriptionQuotaSnapshot, SubscriptionSource } from "../types";

/** 拿不到重置时间时的默认不可用时长。 */
export const DEFAULT_EXHAUSTION_MS = 30 * 60 * 1000;
/** 单个账号一次不可用状态的最长时长。 */
export const MAX_EXHAUSTION_MS = 7 * 24 * 60 * 60 * 1000;
/** 不可用状态的最短时长：防止上游给一个已过去的重置时间导致立刻反复重试。 */
export const MIN_EXHAUSTION_MS = 60 * 1000;

/** 一个账号的额度可用性。 */
export interface QuotaAvailabilityEntry {
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 账号 ID。 */
	readonly accountId: string;
	/** 不可用截止时间（毫秒时间戳）。 */
	readonly exhaustedUntil: number;
	/** 展示用原因，写进「都在冷却中」的回显与日志。 */
	readonly reason: string;
	/** 观察到该状态的时间（毫秒时间戳）。 */
	readonly observedAt: number;
}

/**
 * 窗口剩余比例是否已经用尽。
 * @param fraction - 剩余比例（0..1）
 */
function isSpent(fraction: number | undefined): boolean {
	return typeof fraction === "number" && Number.isFinite(fraction) && fraction <= 0;
}

/**
 * 解析 ISO 时间；无效或缺省返回 undefined。
 * @param value - ISO 8601 字符串
 */
function parseTime(value: string | undefined): number | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 把截止时间夹进 [now+MIN, now+MAX] 区间。
 * @param until - 期望截止时间
 * @param now - 当前时间
 */
function clampUntil(until: number, now: number): number {
	return Math.min(Math.max(until, now + MIN_EXHAUSTION_MS), now + MAX_EXHAUSTION_MS);
}

/**
 * 账号额度可用性表。
 */
export class QuotaAvailability {
	private readonly _entries = new Map<string, QuotaAvailabilityEntry>();

	/**
	 * 用一次额度快照刷新账号状态。
	 *
	 * 快照带 `error` 时不动已有状态：拉取失败说明不知道，而不是知道「有额度」。
	 * 没有任何窗口用尽时清掉旧状态，让账号立即回到调度范围。
	 * @param source - 订阅来源
	 * @param accountId - 账号 ID
	 * @param snapshot - Provider 归一化后的额度快照
	 * @param now - 当前时间
	 * @returns 写入的状态；账号变为可用时为 undefined
	 */
	applySnapshot(
		source: SubscriptionSource,
		accountId: string,
		snapshot: SubscriptionQuotaSnapshot,
		now = Date.now(),
	): QuotaAvailabilityEntry | undefined {
		if (snapshot.error !== undefined) {
			return this.state(source, accountId, now);
		}
		const spent = (snapshot.windows ?? []).filter((window) => isSpent(window.remainingFraction));
		if (spent.length === 0) {
			this._entries.delete(this._key(source, accountId));
			return undefined;
		}
		// 多个窗口同时用尽时按最晚的重置时间等待：任何一个还没恢复都还会失败。
		let until = 0;
		for (const window of spent) {
			until = Math.max(until, parseTime(window.resetTime) ?? now + DEFAULT_EXHAUSTION_MS);
		}
		const names = spent.map((window) => window.name).join("、");
		return this.markExhausted(source, accountId, clampUntil(until, now), `额度窗口已用尽（${names}）`, now);
	}

	/**
	 * 记录账号额度耗尽。
	 * @param source - 订阅来源
	 * @param accountId - 账号 ID
	 * @param until - 重置时间（毫秒时间戳）；缺省按默认时长
	 * @param reason - 展示用原因
	 * @param now - 当前时间
	 */
	markExhausted(
		source: SubscriptionSource,
		accountId: string,
		until: number | undefined,
		reason: string,
		now = Date.now(),
	): QuotaAvailabilityEntry {
		const entry: QuotaAvailabilityEntry = {
			source: source,
			accountId: accountId,
			exhaustedUntil: clampUntil(until ?? now + DEFAULT_EXHAUSTION_MS, now),
			reason: reason,
			observedAt: now,
		};
		this._entries.set(this._key(source, accountId), entry);
		return entry;
	}

	/**
	 * 标记账号已恢复可用（或观察到成功）。返回是否真的清掉了状态。
	 * @param source - 订阅来源
	 * @param accountId - 账号 ID
	 */
	markAvailable(source: SubscriptionSource, accountId: string): boolean {
		return this._entries.delete(this._key(source, accountId));
	}

	/**
	 * 读取账号当前状态；已过重置时间的状态被清理并返回 undefined。
	 * @param source - 订阅来源
	 * @param accountId - 账号 ID
	 * @param now - 当前时间
	 */
	state(source: SubscriptionSource, accountId: string, now = Date.now()): QuotaAvailabilityEntry | undefined {
		const key = this._key(source, accountId);
		const entry = this._entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.exhaustedUntil <= now) {
			this._entries.delete(key);
			return undefined;
		}
		return entry;
	}

	/**
	 * 当前不可用的账号集合。
	 * @param source - 订阅来源
	 * @param now - 当前时间
	 */
	blocked(source: SubscriptionSource, now = Date.now()): ReadonlySet<string> {
		const blocked = new Set<string>();
		for (const entry of [...this._entries.values()]) {
			if (entry.source !== source) {
				continue;
			}
			if (entry.exhaustedUntil <= now) {
				this._entries.delete(this._key(entry.source, entry.accountId));
				continue;
			}
			blocked.add(entry.accountId);
		}
		return blocked;
	}

	/**
	 * 全部仍然有效的状态，用于落盘与诊断。
	 * @param now - 当前时间
	 */
	entries(now = Date.now()): readonly QuotaAvailabilityEntry[] {
		return [...this._entries.values()].filter((entry) => entry.exhaustedUntil > now);
	}

	/**
	 * 用落盘状态恢复（进程重启后不再用失败请求重新探路）。
	 * @param entries - 上次持久化的状态
	 * @param now - 当前时间
	 */
	hydrate(entries: readonly QuotaAvailabilityEntry[], now = Date.now()): void {
		for (const entry of entries) {
			if (entry.exhaustedUntil <= now) {
				continue;
			}
			this._entries.set(this._key(entry.source, entry.accountId), {
				...entry,
				exhaustedUntil: clampUntil(entry.exhaustedUntil, now),
			});
		}
	}

	/** 清空全部状态。 */
	reset(): void {
		this._entries.clear();
	}

	private _key(source: SubscriptionSource, accountId: string): string {
		return `${source}\0${accountId}`;
	}
}
