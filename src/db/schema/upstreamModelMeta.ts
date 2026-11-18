import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 上游模型元信息弱缓存 - LiteLLM_UpstreamModelMeta
 *
 * 每个 (来源, 上游模型 ID) 一行；`model_id = '*'` 是来源级状态行。`metadata` 存归一化
 * 字段，`raw` 存上游原始条目的精简版，`expires_at` 过期后仍可读（读取方不等待上游，
 * 由后台刷新）。表结构见 drizzle/0021_upstream_model_metadata.sql。
 */
export const LiteLLM_UpstreamModelMeta = pgTable(
	"LiteLLM_UpstreamModelMeta",
	{
		source: text("source").notNull(),
		model_id: text("model_id").notNull(),
		status: text("status").$type<"ok" | "unsupported" | "error">().notNull(),
		display_name: text("display_name"),
		metadata: jsonb("metadata"),
		raw: jsonb("raw"),
		error: text("error"),
		fetched_at: timestamp("fetched_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
		expires_at: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.source, table.model_id], name: "upstream_model_meta_pkey" }),
		index("idx_upstream_model_meta_expires").on(table.expires_at),
	],
);
