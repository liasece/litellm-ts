/**
 * 仓储实例与进程内副本的绑定工具 — repository 层私有构件。
 *
 * 每个仓储都要做同样的三件事：按数据库连接复用单例、给整表副本或按键缓存建一份
 * 进程级实例、把表访问收敛到一个文件里。这些样板集中在这里，仓储文件本身只描述
 * 「这张表怎么读写」和「写完怎么让缓存跟上」。
 *
 * 绑定的键是 Drizzle 连接对象：同一连接上的所有调用方共享同一份缓存，测试里换一个
 * 连接就是全新的一套，不会互相串数据。
 */

import type { DrizzleDb } from "../../core/db/Database";
import { EntryCache } from "./EntryCache";
import type { EntryCacheOptions } from "./EntryCache";
import { revisionCounterFor, TableCache } from "./TableCache";

/** 以数据库连接为键的弱引用表，避免测试或重建连接时泄漏。 */
const singletons = new WeakMap<object, Map<string, unknown>>();

function bucket(db: object, name: string): Map<string, unknown> {
	let existing = singletons.get(db);
	if (existing === undefined) {
		existing = new Map<string, unknown>();
		singletons.set(db, existing);
	}
	void name;
	return existing;
}

/**
 * 把工厂函数包装成「同一数据库连接只创建一次」的取用函数。
 * @template Repository - 仓储类型
 * @param create - 构造函数
 */
export function singletonFor<Repository>(create: (db: DrizzleDb) => Repository): (db: DrizzleDb) => Repository {
	const created = new WeakMap<object, Repository>();
	return (db: DrizzleDb): Repository => {
		const key = db as unknown as object;
		const existing = created.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const value = create(db);
		created.set(key, value);
		return value;
	};
}

/**
 * 取得（或创建）与数据库连接绑定的整表副本。
 * @template Row - 表行类型
 * @param db - Drizzle 数据库实例
 * @param name - 缓存名，同一连接上必须唯一（通常就是表名）
 * @param load - 全量装载回调
 * @param options - 兜底刷新间隔等
 */
export function tableCacheFor<Row>(
	db: DrizzleDb,
	name: string,
	load: () => Promise<Row[]>,
	options: { safetyRefreshMs?: number; now?: () => number } = {},
): TableCache<Row> {
	const slot = bucket(db as unknown as object, name);
	const key = `table:${name}`;
	const existing = slot.get(key);
	if (existing !== undefined) {
		return existing as TableCache<Row>;
	}
	const created = new TableCache<Row>(load, revisionCounterFor(db as unknown as object), options);
	slot.set(key, created);
	return created;
}

/**
 * 取得（或创建）与数据库连接绑定的按键缓存。
 * @template Value - 缓存值类型
 * @param db - Drizzle 数据库实例
 * @param name - 缓存名，同一连接上必须唯一（通常是表名或仓储名）
 * @param options - TTL、提前刷新与容量
 */
export function entryCacheFor<Value>(db: DrizzleDb, name: string, options: EntryCacheOptions): EntryCache<Value> {
	const slot = bucket(db as unknown as object, name);
	const key = `entry:${name}`;
	const existing = slot.get(key);
	if (existing !== undefined) {
		return existing as EntryCache<Value>;
	}
	const created = new EntryCache<Value>({ ...options, label: options.label ?? name });
	slot.set(key, created);
	return created;
}
