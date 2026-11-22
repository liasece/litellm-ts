/**
 * 单表进程内副本 — repository 层私有构件。
 *
 * 每张运行时热表由拥有它的 repository 各自持有一份副本，表访问与缓存失效都不离开该 repository：
 * - 读取：首次或失效后装载一次，并发读取合并为同一次查询；
 * - 写入：repository 在数据库写入成功后调用 `mutate` 或 `invalidate`，副本立即跟上，
 *   因此应用内的配置变更对下一个请求立刻生效，没有 TTL 窗口；
 * - 冷启动装载失败：抛错（fail closed），不回落旧值；已有副本后的后台刷新失败：保留副本并告警；
 * - 版本号：同一数据库连接上的所有表共享一个单调计数器，供请求级快照判重。
 */
import { createModuleLogger } from "../../core/utils/logger";

const logger = createModuleLogger("TableCache");

/**
 * 绕过应用直接改库时，最迟多久能被读到。
 *
 * 服务是单实例部署、配置变更都经过本进程的仓储层写穿，这个刷新只兜「运维直接改库」，
 * 因此放在分钟级即可；频繁整表重读对小配置表没有收益。
 */
export const SAFETY_REFRESH_MS = 300_000;

/** 调整兜底刷新间隔的环境变量；0 表示关闭兜底刷新（只靠写穿与失效）。 */
export const TABLE_CACHE_SAFETY_REFRESH_ENV = "LITELLM_TABLE_CACHE_SAFETY_REFRESH_MS";

/**
 * 解析兜底刷新间隔；非法输入回落到默认值，0 表示关闭。
 * @param raw - 环境变量原文
 */
export function resolveSafetyRefreshMs(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") {
		return SAFETY_REFRESH_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return SAFETY_REFRESH_MS;
	}
	return Math.round(parsed);
}

/** 同一数据库连接上所有表缓存共享的版本计数器。 */
export interface RevisionCounter {
	/** 当前版本号；装载和失效都会递增。 */
	value: number;
}

const counters = new WeakMap<object, RevisionCounter>();

/**
 * 取得与数据库连接绑定的版本计数器；同一连接共享同一个计数器。
 * @param db - 数据库连接，作为共享范围的标识
 */
export function revisionCounterFor(db: object): RevisionCounter {
	const existing = counters.get(db);
	if (existing !== undefined) {
		return existing;
	}
	const created: RevisionCounter = { value: 0 };
	counters.set(db, created);
	return created;
}

/**
 * 单表进程内副本。
 * @template Row - 表行类型
 */
export class TableCache<Row> {
	private _rows: Row[] | null = null;
	private _refreshedAt = 0;
	private _refreshing = false;
	private _inflight: Promise<void> | null = null;

	private readonly _safetyRefreshMs: number;
	private readonly _now: () => number;

	/**
	 * @param _load - 全量装载该表的回调；SQL 只写在拥有该表的 repository 里
	 * @param _revision - 与数据库连接绑定的共享版本计数器
	 * @param options - 兜底刷新间隔与可注入时钟
	 */
	constructor(
		private readonly _load: () => Promise<Row[]>,
		private readonly _revision: RevisionCounter,
		options: { safetyRefreshMs?: number; now?: () => number } = {},
	) {
		this._safetyRefreshMs = options.safetyRefreshMs ?? resolveSafetyRefreshMs(process.env[TABLE_CACHE_SAFETY_REFRESH_ENV]);
		this._now = options.now ?? Date.now;
	}

	/** 当前版本号；装载或失效后递增，供请求级快照判重。 */
	revision(): number {
		return this._revision.value;
	}

	/**
	 * 读取全量行。返回的数组与行对象是共享副本，调用方只读，不得修改。
	 * @returns 当前副本的全部行
	 */
	async rows(): Promise<Row[]> {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (this._rows !== null) {
				this._scheduleSafetyRefresh();
				return this._rows;
			}
			const pending = this._inflight;
			if (pending !== null) {
				await pending;
				continue;
			}
			const load = this._loadOnce();
			this._inflight = load;
			try {
				await load;
			} finally {
				if (this._inflight === load) {
					this._inflight = null;
				}
			}
		}
		if (this._rows === null) {
			// 连续失效导致副本无法稳定，按 fail closed 处理，不用空配置继续路由。
			throw new Error("运行时配置表无法稳定装载");
		}
		return this._rows;
	}

	/**
	 * 写入成功后同步副本，使下一个请求读到新值；副本尚未装载时无需处理（下一次读取会装载最新值）。
	 * @param update - 基于现有行构造新行的纯函数
	 */
	mutate(update: (rows: Row[]) => Row[]): void {
		if (this._rows === null) {
			return;
		}
		this._rows = update(this._rows);
		this._revision.value += 1;
	}

	/**
	 * 写穿：把一行按主键合并进副本（存在则替换，不存在则追加）。
	 *
	 * 单例部署下写路径就是副本的唯一来源，因此写完直接改副本比整表失效更省一次查询，
	 * 也让「写完立刻读」拿到的一定是新值。
	 * @param row - 写入后的整行
	 * @param keyOf - 从行里取主键，用于定位要被替换的那一行
	 */
	upsert(row: Row, keyOf: (row: Row) => string): void {
		if (this._rows === null) {
			return;
		}
		const target = keyOf(row);
		let replaced = false;
		this._rows = this._rows.map((existing) => {
			if (keyOf(existing) === target) {
				replaced = true;
				return row;
			}
			return existing;
		});
		if (!replaced) {
			this._rows = [...this._rows, row];
		}
		this._revision.value += 1;
	}

	/**
	 * 写穿：把满足条件的行从副本里移除（删除操作）。
	 * @param predicate - 命中即移除
	 */
	remove(predicate: (row: Row) => boolean): void {
		if (this._rows === null || this._rows.every((row) => !predicate(row))) {
			return;
		}
		this._rows = this._rows.filter((row) => !predicate(row));
		this._revision.value += 1;
	}

	/** 写入路径无法精确同步时直接失效，下一次读取重新装载。 */
	invalidate(): void {
		if (this._rows === null) {
			return;
		}
		this._rows = null;
		this._revision.value += 1;
	}

	private async _loadOnce(): Promise<void> {
		this._rows = await this._load();
		this._refreshedAt = this._now();
		this._revision.value += 1;
	}

	private _scheduleSafetyRefresh(): void {
		if (this._safetyRefreshMs <= 0 || this._refreshing || this._now() - this._refreshedAt < this._safetyRefreshMs) {
			return;
		}
		this._refreshing = true;
		void this._refresh()
			.then(() => {
				this._refreshedAt = this._now();
			})
			.catch((error: unknown) => {
				logger.warn("运行时配置表后台刷新失败，继续使用现有副本", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				this._refreshing = false;
			});
	}

	private async _refresh(): Promise<void> {
		const rows = await this._load();
		this._rows = rows;
		this._revision.value += 1;
	}
}
