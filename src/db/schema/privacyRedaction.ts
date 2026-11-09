import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidText } from "./uuidText";

/**
 * 每次请求的脱敏汇总一行（仅有命中时写入）。
 *
 * 用于「观测 → 脱敏」页面的总量卡片与按客户端 / 提供方 / 类型分布：
 * - occurrences：本次请求实际替换的处数；
 * - distinct_values：本次请求命中的不同值的数量；
 * - kinds：各脱敏类型的处数，形如 `{ "API_KEY": 3, "EMAIL": 1 }`；
 * - action：本次请求应用的处置（mask / warn / block）；
 * - unresolved：响应里出现但无法还原的占位符数量（上游改写了占位符或流中断）。
 */
export const liteLLM_PrivacyRedactionEvents = pgTable(
	"LiteLLM_PrivacyRedactionEvents",
	{
		id: uuidText("id").primaryKey(),
		request_id: text("request_id").notNull(),
		created_at: timestamp("created_at", { precision: 3 }).notNull(),
		api_key: text("api_key").default("").notNull(),
		user_id: text("user_id"),
		team_id: text("team_id"),
		client: text("client").default("").notNull(),
		provider: text("provider").default("").notNull(),
		model: text("model").default("").notNull(),
		kinds: jsonb("kinds").$type<Record<string, number>>().default({}).notNull(),
		occurrences: integer("occurrences").default(0).notNull(),
		distinct_values: integer("distinct_values").default(0).notNull(),
		action: text("action").default("mask").notNull(),
		duration_ms: integer("duration_ms").default(0).notNull(),
		unresolved: integer("unresolved").default(0).notNull(),
	},
	(table) => [
		index("privacy_events_created_idx").on(table.created_at),
		index("privacy_events_client_idx").on(table.client),
		index("privacy_events_provider_idx").on(table.provider),
		index("privacy_events_request_idx").on(table.request_id),
	],
);

/**
 * 每个请求内每个不同脱敏值一行（只保存可展示的派生信息）。
 *
 * 刻意不保存原文：value_hash 是占位符里的 HMAC 片段，hint 是前 3 个字符，
 * value_length 是原始长度。三者组合足以在页面上区分「哪个值」，
 * 又不足以还原被保护的内容。
 */
export const liteLLM_PrivacyRedactionValues = pgTable(
	"LiteLLM_PrivacyRedactionValues",
	{
		id: uuidText("id").primaryKey(),
		request_id: text("request_id").notNull(),
		created_at: timestamp("created_at", { precision: 3 }).notNull(),
		kind: text("kind").notNull(),
		value_hash: text("value_hash").notNull(),
		value_length: integer("value_length").default(0).notNull(),
		hint: text("hint").default("").notNull(),
		occurrences: integer("occurrences").default(1).notNull(),
		client: text("client").default("").notNull(),
		provider: text("provider").default("").notNull(),
		model: text("model").default("").notNull(),
	},
	(table) => [
		index("privacy_values_created_idx").on(table.created_at),
		index("privacy_values_kind_idx").on(table.kind),
		index("privacy_values_hash_idx").on(table.value_hash, table.created_at),
		index("privacy_values_request_idx").on(table.request_id),
	],
);
