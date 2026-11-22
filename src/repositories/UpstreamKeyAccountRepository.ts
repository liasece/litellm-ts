/**
 * LiteLLM_UpstreamKeyAccount 仓库 — 上游 key 指纹到账号 / Credential 的关联写入与批量读取。
 *
 * 这张表按 key 指纹追加、不覆盖历史：同一个订阅账号轮换 token 后会产生多个 hash，
 * 旧行必须保留才能让历史 Usage 继续归到同一账号。写入因此是 `ON CONFLICT DO NOTHING`，
 * 由结算事务顺带完成，不单独开启事务。
 *
 * 行数随「使用过的上游 key 数」增长，属于流水性质，不做缓存。
 */

import { inArray } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_UpstreamKeyAccount } from "../db/schema/upstreamKeyAccount";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_UpstreamKeyAccount` 行。 */
export type UpstreamKeyAccountRow = typeof LiteLLM_UpstreamKeyAccount.$inferSelect;

/** 新建关联行时可写入的列。 */
export type UpstreamKeyAccountInsert = typeof LiteLLM_UpstreamKeyAccount.$inferInsert;

/** 事务句柄；关联写入与 SpendLog 插入同事务。 */
export type UpstreamKeyAccountTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * 取得与数据库连接绑定的上游 key 关联仓库。
 * @param db - Drizzle 数据库实例
 */
export const upstreamKeyAccountRepositoryFor = singletonFor((db: DrizzleDb) => new UpstreamKeyAccountRepository(db));

/** `LiteLLM_UpstreamKeyAccount` 的读写入口。 */
export class UpstreamKeyAccountRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 追加一条 key → 账号关联；同一 hash 已存在时保留首次归属。
	 *
	 * 即使 SpendLog 已存在（重复 request_id），也要补写归属，否则这一行以后只能按
	 * Unassociated 展示；因此调用方在幂等判重之前执行本方法。
	 * @param tx - 结算事务句柄
	 * @param values - 关联行
	 */
	async insertIgnore(tx: UpstreamKeyAccountTransaction, values: UpstreamKeyAccountInsert): Promise<void> {
		await tx.insert(LiteLLM_UpstreamKeyAccount).values(values).onConflictDoNothing();
	}

	/**
	 * 按 key 指纹批量读取关联行；报表按这些 hash 把 Usage 归到账号。
	 * @param keyHashes - SHA-256 key 指纹
	 * @returns 命中的关联行；空入参返回空数组，避免生成非法 `IN ()`
	 */
	async listByKeyHashes(keyHashes: readonly string[]): Promise<UpstreamKeyAccountRow[]> {
		if (keyHashes.length === 0) {
			return [];
		}
		return await this._db
			.select()
			.from(LiteLLM_UpstreamKeyAccount)
			.where(inArray(LiteLLM_UpstreamKeyAccount.key_hash, [...keyHashes]));
	}
}
