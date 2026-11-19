/**
 * 订阅账号仓库 - LiteLLM_SubscriptionAccount 的唯一访问点。
 *
 * 账号正文（旧 auth JSON）整段存在 `payload`，有效性由 `trashed_at` 决定；本仓库只做
 * 行级读写，不解释 token。`account_id` 沿用旧 `auth_index` 的派生方式，升级后额度接口
 * 与页面书签里的账号 ID 不变。
 */

import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_SubscriptionAccount } from "../db/schema/subscriptionAccounts";
import type {
	NewStoredSubscriptionAccount,
	StoredSubscriptionAccount,
	StoredSubscriptionAccountPatch,
	SubscriptionAccountPersistence,
} from "../subscriptions/native/accountPersistence";
import type { SubscriptionSource } from "../subscriptions/native/types";

/**
 * 数据库行 → 账号行。
 * @param row - 数据库行
 */
function toStored(row: typeof LiteLLM_SubscriptionAccount.$inferSelect): StoredSubscriptionAccount {
	return {
		id: row.account_id,
		source: row.provider as SubscriptionSource,
		key: row.account_key,
		payload: isRecord(row.payload) ? row.payload : {},
		trashedAt: row.trashed_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * 判断普通对象。
 * @param value - 待判定值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 订阅账号仓库。 */
export class SubscriptionAccountRepository implements SubscriptionAccountPersistence {
	/**
	 * @param _db - Drizzle 数据库实例
	 */
	constructor(private readonly _db: DrizzleDb) {}

	/**
	 * 列出账号，包含回收站。
	 * @param source - 可选来源过滤
	 */
	async list(source?: SubscriptionSource): Promise<StoredSubscriptionAccount[]> {
		const query = this._db.select().from(LiteLLM_SubscriptionAccount);
		const rows = source === undefined ? await query : await query.where(eq(LiteLLM_SubscriptionAccount.provider, source));
		return rows.map(toStored);
	}

	/**
	 * 按账号 ID 读取。
	 * @param id - 稳定账号 ID
	 */
	async find(id: string): Promise<StoredSubscriptionAccount | undefined> {
		const rows = await this._db
			.select()
			.from(LiteLLM_SubscriptionAccount)
			.where(eq(LiteLLM_SubscriptionAccount.account_id, id))
			.limit(1);
		const row = rows[0];
		return row === undefined ? undefined : toStored(row);
	}

	/**
	 * 按来源与账号键读取。
	 * @param source - 订阅来源
	 * @param key - 账号键
	 */
	async findByKey(source: SubscriptionSource, key: string): Promise<StoredSubscriptionAccount[]> {
		const rows = await this._db
			.select()
			.from(LiteLLM_SubscriptionAccount)
			.where(and(eq(LiteLLM_SubscriptionAccount.provider, source), eq(LiteLLM_SubscriptionAccount.account_key, key)));
		return rows.map(toStored);
	}

	/**
	 * 插入账号。
	 * @param row - 新账号行
	 */
	async insert(row: NewStoredSubscriptionAccount): Promise<void> {
		await this._db.insert(LiteLLM_SubscriptionAccount).values({
			account_id: row.id,
			provider: row.source,
			account_key: row.key,
			payload: row.payload,
			trashed_at: row.trashedAt ?? null,
		});
	}

	/**
	 * 更新账号。
	 * @param id - 稳定账号 ID
	 * @param patch - 待更新字段
	 */
	async update(id: string, patch: StoredSubscriptionAccountPatch): Promise<StoredSubscriptionAccount | undefined> {
		const values: Partial<typeof LiteLLM_SubscriptionAccount.$inferInsert> = { updated_at: new Date() };
		if (patch.payload !== undefined) {
			values.payload = patch.payload;
		}
		if (patch.trashedAt !== undefined) {
			values.trashed_at = patch.trashedAt;
		}
		const rows = await this._db
			.update(LiteLLM_SubscriptionAccount)
			.set(values)
			.where(eq(LiteLLM_SubscriptionAccount.account_id, id))
			.returning();
		const row = rows[0];
		return row === undefined ? undefined : toStored(row);
	}

	/**
	 * 删除账号。
	 * @param id - 稳定账号 ID
	 */
	async remove(id: string): Promise<void> {
		await this._db.delete(LiteLLM_SubscriptionAccount).where(eq(LiteLLM_SubscriptionAccount.account_id, id));
	}
}
