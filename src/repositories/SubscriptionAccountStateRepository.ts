/**
 * 订阅账号调度状态仓库 - LiteLLM_SubscriptionAccountState 的唯一访问点。
 *
 * 只存调度提示（最近失败时间、额度耗尽截止时间），不解释账号正文；写入按 accountId
 * upsert，读取一次性全量（账号数量是十几个量级，不需要分页）。
 */

import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { singletonFor } from "./internal/registry";
import { LiteLLM_SubscriptionAccountState } from "../db/schema/subscriptionAccountState";
import type { StoredAccountState, SubscriptionAccountStatePersistence } from "../subscriptions/native/quota/accountStatePersistence";
import type { SubscriptionSource } from "../subscriptions/native/types";

/**
 * 毫秒时间戳 → 数据库时间；空值保持为空。
 * @param value - 毫秒时间戳
 */
function toDate(value: number | undefined): Date | null {
	return value === undefined ? null : new Date(value);
}

/** 订阅账号调度状态仓库。 */
export class SubscriptionAccountStateRepository implements SubscriptionAccountStatePersistence {
	/**
	 * @param _db - Drizzle 数据库实例
	 */
	constructor(private readonly _db: DrizzleDb) {}

	/** 读取全部账号状态。 */
	async list(): Promise<StoredAccountState[]> {
		const rows = await this._db.select().from(LiteLLM_SubscriptionAccountState);
		return rows.map((row) => ({
			accountId: row.account_id,
			source: row.provider as SubscriptionSource,
			...(row.last_failure_at === null ? {} : { lastFailureAt: row.last_failure_at.getTime() }),
			...(row.exhausted_until === null ? {} : { exhaustedUntil: row.exhausted_until.getTime() }),
			...(row.reason === null ? {} : { reason: row.reason }),
		}));
	}

	/**
	 * 按账号写入状态；不存在则插入。
	 * @param states - 待写入状态
	 */
	async upsert(states: readonly StoredAccountState[]): Promise<void> {
		if (states.length === 0) {
			return;
		}
		await this._db
			.insert(LiteLLM_SubscriptionAccountState)
			.values(
				states.map((state) => ({
					account_id: state.accountId,
					provider: state.source,
					last_failure_at: toDate(state.lastFailureAt),
					exhausted_until: toDate(state.exhaustedUntil),
					reason: state.reason ?? null,
				})),
			)
			.onConflictDoUpdate({
				target: LiteLLM_SubscriptionAccountState.account_id,
				set: {
					provider: sql`excluded.provider`,
					last_failure_at: sql`excluded.last_failure_at`,
					exhausted_until: sql`excluded.exhausted_until`,
					reason: sql`excluded.reason`,
					updated_at: sql`now()`,
				},
			});
	}
}

/**
 * 按 db 实例取仓储单例（同一个 db 只构造一次）。
 * @param db - drizzle 句柄
 */
export const subscriptionAccountStateRepositoryFor = singletonFor((db: DrizzleDb) => new SubscriptionAccountStateRepository(db));
