/** Usage 原始行缓存配置。 */
export interface UsageActivityCacheOptions {
	/** 数据新鲜期；期间直接返回缓存。 */
	readonly ttlMs?: number;
	/** 新鲜期结束后仍可作为 stale 返回的时长；返回时后台刷新。 */
	readonly staleMs?: number;
	/** 最多保留的查询组合数，按最近使用顺序淘汰。 */
	readonly maxEntries?: number;
	/** 当前时间函数，测试可替换。 */
	readonly now?: () => number;
	/** 后台刷新失败回调；不应抛出。 */
	readonly onRefreshError?: (error: unknown) => void;
}

/**
 * 单条缓存记录。
 * @template T - 缓存的查询结果类型
 */
interface CacheEntry<T> {
	readonly value: T;
	freshUntil: number;
	readonly staleUntil: number;
	refreshing?: boolean;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_STALE_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 4;
const REFRESH_RETRY_MS = 5_000;

/**
 * Usage 原始日志行的短时缓存。
 *
 * 时区视图必须扫描近几天的 SpendLogs，而 summary/detail/full 是同一批原始行。
 * 缓存按调用方鉴权范围和过滤条件隔离；过期后先返回 stale，再在后台刷新，
 * 避免切换 Tab 时重复等待同一份聚合查询。缓存只存在于当前进程内存。
 * @template T - 缓存的查询结果类型
 */
export class UsageActivityCache<T> {
	private readonly _entries = new Map<string, CacheEntry<T>>();
	private readonly _inflight = new Map<string, Promise<T>>();
	private readonly _ttlMs: number;
	private readonly _staleMs: number;
	private readonly _maxEntries: number;
	private readonly _now: () => number;
	private readonly _onRefreshError?: (error: unknown) => void;

	constructor(options: UsageActivityCacheOptions = {}) {
		this._ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this._staleMs = options.staleMs ?? DEFAULT_STALE_MS;
		this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this._now = options.now ?? Date.now;
		this._onRefreshError = options.onRefreshError;
	}

	/**
	 * 读取缓存；没有可用条目时等待加载。stale 条目会立即返回并触发一次后台刷新。
	 * @param key - 已包含鉴权范围与查询条件的稳定键
	 * @param load - 缓存未命中或后台刷新时执行的加载函数
	 */
	async get(key: string, load: () => Promise<T>): Promise<T> {
		const now = this._now();
		const entry = this._entries.get(key);
		if (entry && now < entry.staleUntil) {
			if (now >= entry.freshUntil) {
				this._refresh(key, load, entry);
			}
			return entry.value;
		}
		if (entry) {
			this._entries.delete(key);
		}
		return this._load(key, load);
	}

	private async _load(key: string, load: () => Promise<T>): Promise<T> {
		const pending = this._inflight.get(key);
		if (pending) {
			return pending;
		}
		const promise = (async () => {
			const value = await load();
			this._store(key, value);
			return value;
		})();
		this._inflight.set(key, promise);
		try {
			return await promise;
		} finally {
			if (this._inflight.get(key) === promise) {
				this._inflight.delete(key);
			}
		}
	}

	private _refresh(key: string, load: () => Promise<T>, entry: CacheEntry<T>): void {
		if (entry.refreshing) {
			return;
		}
		entry.refreshing = true;
		void (async () => {
			try {
				const value = await load();
				// 刷新期间可能已有新的冷加载写入，不能用旧请求覆盖新结果。
				if (this._entries.get(key) === entry) {
					this._store(key, value);
				}
			} catch (error: unknown) {
				// 保留 stale 数据；短暂退避，避免每次请求都重新打数据库。
				entry.freshUntil = this._now() + REFRESH_RETRY_MS;
				this._onRefreshError?.(error);
			} finally {
				entry.refreshing = false;
			}
		})();
	}

	private _store(key: string, value: T): void {
		const now = this._now();
		this._entries.delete(key);
		this._entries.set(key, {
			value: value,
			freshUntil: now + this._ttlMs,
			staleUntil: now + this._ttlMs + this._staleMs,
		});
		while (this._entries.size > this._maxEntries) {
			const oldest = this._entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this._entries.delete(oldest);
		}
	}
}
