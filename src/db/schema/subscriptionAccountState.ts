import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 订阅账号调度状态 - LiteLLM_SubscriptionAccountState
 *
 * 一行一个账号：最近一次上游失败时间，以及额度耗尽的截止时间。两者都只是调度的
 * 提示信息，账号本身的有效性仍由 `LiteLLM_SubscriptionAccount.trashed_at` 决定。
 * 表结构见 drizzle/0024_subscription_account_state.sql。
 */
export const LiteLLM_SubscriptionAccountState = pgTable("LiteLLM_SubscriptionAccountState", {
	/** 稳定账号 ID；与 LiteLLM_SubscriptionAccount.account_id 对应。 */
	account_id: text("account_id").primaryKey(),
	/** 订阅来源（codex/claude/...）。 */
	provider: text("provider").notNull(),
	/** 最近一次上游失败时间。 */
	last_failure_at: timestamp("last_failure_at", { withTimezone: true, precision: 3 }),
	/** 额度耗尽的重置时间；为空表示没有已知的额度耗尽。 */
	exhausted_until: timestamp("exhausted_until", { withTimezone: true, precision: 3 }),
	/** 额度耗尽原因（展示用）。 */
	reason: text("reason"),
	/** 最近写入时间。 */
	updated_at: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
});
