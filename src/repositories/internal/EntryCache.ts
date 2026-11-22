/**
 * 按键缓存 — repository 层私有构件。
 *
 * 整表副本（TableCache）适合行数固定在几十行以内的配置表；而 key、用户、团队、预算这类表
 * 行数会随租户增长，只能按主键缓存命中的那几行，因此需要这个按键缓存：
 *
 * - 读取命中即返回；剩余 TTL 不足阈值时再排一次后台补读，把「刚好过期」的那次同步查询
 *   移出请求路径（提前刷新）；
 * - 写入在数据库提交成功后立刻 `set` 新值（写穿）：单例部署下本进程就是唯一写入方，
 *   下一个请求读到的必然是刚写进去的行，不需要等 TTL；
 * - 跨实体的失效用标签（如 `user:<id>`、`team:<id>`），写路径删掉主体后按标签批量失效；
 * - TTL 只兜底「本进程之外」的变更（运维直接改库、旧的 Python 实例）。单例部署下这个窗口
 *   可以放到分钟级，用环境变量控制；
 * - 负结果（不存在）不缓存：遍历式无效 key 探测不应把缓存撑大，也不该让刚创建的实体在
 *   TTL 内不可用；
 * - 后台补读失败只保留旧值并记 debug；补读期间条目被替换或失效则丢弃这次结果。
 */

import { createModuleLogger } from "../../core/utils/logger";

const logger = createModuleLogger("EntryCache");

/** 一条缓存记录。 */
interface Entry {
	readonly value: unknown;
	readonly expiresAt: number;
	readonly tags: readonly string[];
}

/**
 * 失效标签：固定列表，或按补读到的新值动态计算。
 * @template T - 实体行类型
 */
export type EntryTags<T> = readonly string[] | ((value: T) => readonly string[]);

/**
 * 解析写入用的标签；负结果不写缓存，因此不需要标签。
 * @template T - 实体行类型
 * @param tags - 固定列表或按值计算
 * @param value - 读取到的实体行
 */
function resolveTags<T>(tags: EntryTags<T>, value: T | null | undefined): readonly string[] {
	if (typeof tags !== "function") {
		return tags;
	}
	return value === null || value === undefined ? [] : tags(value);
}

/** 构造参数。 */
export interface EntryCacheOptions {
	/** 条目存活时间（毫秒）；0 关闭缓存。 */
	readonly ttlMs: number;
	/** 提前刷新阈值（毫秒）：剩余 TTL 低于它时后台补读；0 关闭提前刷新。 */
	readonly refreshAheadMs?: number;
	/** 条目上限，超出按插入序淘汰最旧条目。 */
	readonly maxEntries?: number;
	/** 同时进行的后台补读上限。 */
	readonly maxConcurrentRefreshes?: number;
	/** 可注入时钟，测试用。 */
	readonly now?: () => number;
	/** 日志里的缓存名，用于区分是哪个仓储在补读。 */
	readonly label?: string;
}

/** 默认条目上限；够覆盖活跃租户，又不至于让无效探测顶爆内存。 */
export const DEFAULT_ENTRY_CACHE_MAX_ENTRIES = 4096;

/** 默认后台补读并发上限；热点集中过期时不至于把连接池打满。 */
export const DEFAULT_ENTRY_CACHE_MAX_CONCURRENT_REFRESHES = 8;

/**
 * 按键 TTL 缓存，支持标签失效、写穿更新与提前刷新。
 * @template Value - 缓存值类型
 */
export class EntryCache<Value> {
	private readonly _entries = new Map<string, Entry>();
	private readonly _refreshing = new Map<string, Promise<void>>();
	private readonly _ttlMs: number;
	private readonly _refreshAheadMs: number;
	private readonly _maxEntries: number;
	private readonly _maxRefreshes: number;
	private readonly _now: () => number;
	private readonly _label: string;

	/**
	 * @param options - 缓存参数
	 */
	constructor(options: EntryCacheOptions) {
		this._ttlMs = options.ttlMs;
		this._refreshAheadMs = Math.min(options.refreshAheadMs ?? 0, Math.max(0, options.ttlMs));
		this._maxEntries = options.maxEntries ?? DEFAULT_ENTRY_CACHE_MAX_ENTRIES;
		this._maxRefreshes = options.maxConcurrentRefreshes ?? DEFAULT_ENTRY_CACHE_MAX_CONCURRENT_REFRESHES;
		this._now = options.now ?? Date.now;
		this._label = options.label ?? "entry";
	}

	/** 缓存是否生效。 */
	get enabled(): boolean {
		return this._ttlMs > 0;
	}

	/** 当前条目数；用于诊断与测试。 */
	get size(): number {
		return this._entries.size;
	}

	/** 正在后台补读的键数；用于诊断与测试。 */
	get refreshing(): number {
		return this._refreshing.size;
	}

	/** 生效的 TTL。 */
	get ttlMs(): number {
		return this._ttlMs;
	}

	/** 生效的提前刷新阈值；0 表示只做纯 TTL 缓存。 */
	get refreshAheadMs(): number {
		return this._refreshAheadMs;
	}

	/**
	 * 读取缓存；命中时顺带刷新 LRU 位置。
	 * @param key - 缓存键
	 * @param type - 调用方期望的值类型（仅类型层）
	 */
	get<T extends Value = Value>(key: string, type?: "as"): T | undefined {
		void type;
		const entry = this._lookup(key);
		if (entry === undefined) {
			return undefined;
		}
		this._entries.delete(key);
		this._entries.set(key, entry);
		return entry.value as T;
	}

	/**
	 * 读取实体，必要时补读。
	 *
	 * 有条目时立刻返回；只有剩余 TTL 低于阈值才在后台补读，因此请求路径不再承担
	 * 「刚好跨过 TTL」的那次同步查询。没有条目（冷启动、刚被写路径失效）时同步读取，
	 * 语义与直接查库一致。
	 * @param key - 缓存键
	 * @param load - 未命中或需要补读时的读取函数；返回 null 表示实体不存在
	 * @param tags - 写入缓存时使用的失效标签，可按新值动态计算
	 * @returns 实体行或 null
	 */
	async load<T extends Value = Value>(key: string, load: () => Promise<T | null>, tags: EntryTags<T> = []): Promise<T | null> {
		const entry = this._lookup(key);
		if (entry !== undefined) {
			this._entries.delete(key);
			this._entries.set(key, entry);
			this._scheduleRefresh(key, entry, load, tags);
			return entry.value as T;
		}
		const value = await load();
		this.set(key, value, resolveTags(tags, value));
		return value;
	}

	/**
	 * 等待所有在途补读结束；用于测试与优雅停机。
	 */
	async settleRefreshes(): Promise<void> {
		await Promise.allSettled([...this._refreshing.values()]);
	}

	/**
	 * 写入缓存。value 为 null/undefined 时不写（负结果不缓存）。
	 * @param key - 缓存键
	 * @param value - 实体行
	 * @param tags - 失效标签
	 */
	set(key: string, value: Value | null | undefined, tags: readonly string[] = []): void {
		if (!this.enabled || value === null || value === undefined) {
			return;
		}
		if (this._entries.size >= this._maxEntries) {
			const oldest = this._entries.keys().next();
			if (!oldest.done) {
				this._entries.delete(oldest.value);
			}
		}
		this._entries.set(key, { value: value, expiresAt: this._now() + this._ttlMs, tags: tags });
	}

	/**
	 * 删除单个键。
	 * @param key - 缓存键
	 */
	delete(key: string): void {
		this._entries.delete(key);
	}

	/**
	 * 按标签失效（例如某个用户/团队下的全部实体）。
	 * @param tag - 失效标签
	 */
	deleteByTag(tag: string): void {
		for (const [key, entry] of this._entries) {
			if (entry.tags.includes(tag)) {
				this._entries.delete(key);
			}
		}
	}

	/** 清空全部条目。 */
	clear(): void {
		this._entries.clear();
	}

	/**
	 * 读取未过期的条目，不做 LRU 位置调整。
	 * @param key - 缓存键
	 */
	private _lookup(key: string): Entry | undefined {
		if (!this.enabled) {
			return undefined;
		}
		const entry = this._entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.expiresAt <= this._now()) {
			this._entries.delete(key);
			return undefined;
		}
		return entry;
	}

	/**
	 * 命中但临近过期时排一次后台补读；同一键同时只跑一个补读。
	 * @param key - 缓存键
	 * @param entry - 当前命中条目
	 * @param load - 读取函数
	 * @param tags - 失效标签
	 */
	private _scheduleRefresh<T extends Value>(key: string, entry: Entry, load: () => Promise<T | null>, tags: EntryTags<T>): void {
		if (this._refreshAheadMs <= 0 || !this.enabled) {
			return;
		}
		if (entry.expiresAt - this._now() > this._refreshAheadMs) {
			return;
		}
		if (this._refreshing.has(key) || this._refreshing.size >= this._maxRefreshes) {
			return;
		}
		this._refreshing.set(key, this._refresh(key, entry, load, tags));
	}

	/**
	 * 后台补读：失败只保留旧值，不向请求路径抛错；补读期间条目被替换则丢弃结果。
	 * @param key - 缓存键
	 * @param entry - 触发补读时的条目（用于判断期间是否已被失效或替换）
	 * @param load - 读取函数
	 * @param tags - 失效标签
	 */
	private async _refresh<T extends Value>(key: string, entry: Entry, load: () => Promise<T | null>, tags: EntryTags<T>): Promise<void> {
		try {
			const value = await load();
			if (this._entries.get(key) !== entry) {
				return;
			}
			if (value === null || value === undefined) {
				this._entries.delete(key);
				return;
			}
			this.set(key, value, resolveTags(tags, value));
		} catch (error) {
			logger.debug("缓存提前刷新失败，保留旧值", {
				cache: this._label,
				key: key,
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this._refreshing.delete(key);
		}
	}
}
