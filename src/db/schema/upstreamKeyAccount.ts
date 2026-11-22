import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 上游 key 指纹 → 账号 / Credential 的关联表。
 *
 * 一个订阅账号的 OAuth token 会轮换，一个 Credential 的 api_key 也可能更换；
 * 每次实际使用的 key 都会得到不同的 `key_hash`。没有这张表时，Usage 只能按
 * hash 拆成多行，账号维度就失去意义。关联表按 hash 追加，不覆盖历史；账号
 * 删除后行仍保留 account_id，Usage 仍能把旧花费归到同一个账号。
 *
 * 这里只存身份键，不存 label、email 或任何密钥：
 * - `subscription` 的 account_id 指向 `LiteLLM_SubscriptionAccount.account_id`
 * - `credential` 的 account_id 是不可变的 `LiteLLM_CredentialsTable.credential_name`
 */
export const LiteLLM_UpstreamKeyAccount = pgTable(
	"LiteLLM_UpstreamKeyAccount",
	{
		/** 实际 key 的 SHA-256（64 位十六进制）。 */
		key_hash: text("key_hash").primaryKey().notNull(),
		/** `subscription` 或 `credential`；不使用 FK，因为指向两张不同的表。 */
		account_kind: text("account_kind").notNull(),
		/** 订阅账号 ID 或 Credential 名。 */
		account_id: text("account_id").notNull(),
		/** 订阅来源或部署 provider，用于展示与排查。 */
		provider: text("provider").notNull(),
		/** 首次观测到这个 key 归属的时间。 */
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	},
	(table) => [
		// Usage 反向查某账号用过哪些 key；主键已经覆盖按 hash 的 join。
		index("idx_upstream_key_account_identity").on(table.account_kind, table.account_id),
	],
);
