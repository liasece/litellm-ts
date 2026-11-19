import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 订阅账号 - LiteLLM_SubscriptionAccount
 *
 * 一行就是一个订阅账号：`payload` 是旧 auth JSON 原文（token、plan、未知字段无损保留），
 * `trashed_at` 决定账号是否有效——为空即在调度范围内，非空即已进回收站。
 * 账号是否有效不再由文件所在目录表达，因此列表、恢复与去重都只查这张表。
 * 表结构见 drizzle/0022_subscription_accounts.sql。
 */
export const LiteLLM_SubscriptionAccount = pgTable(
	"LiteLLM_SubscriptionAccount",
	{
		/** 稳定账号 ID；沿用旧 `auth_index` 的派生方式，升级后外部引用不变。 */
		account_id: text("account_id").primaryKey(),
		/** 订阅来源（codex/claude/...）。 */
		provider: text("provider").notNull(),
		/** 旧 auth 文件名，作为来源内的账号键保留，便于迁移脚本文档与去重。 */
		account_key: text("account_key").notNull(),
		/** 旧 auth JSON 原文。 */
		payload: jsonb("payload").notNull(),
		/** 移入回收站的时间；为空表示账号有效。 */
		trashed_at: timestamp("trashed_at", { withTimezone: true, precision: 3 }),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
	},
	(table) => [
		// 有效账号在来源内按账号键唯一；回收站行不参与，重登同名账号不会与已回收行冲突。
		uniqueIndex("idx_subscription_account_active_key")
			.on(table.provider, table.account_key)
			.where(sql`${table.trashed_at} is null`),
		index("idx_subscription_account_trashed").on(table.trashed_at),
	],
);
