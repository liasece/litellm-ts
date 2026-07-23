import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * 代理模型表 - LiteLLM_ProxyModelTable
 * model_id 为 text（对齐 Python Prisma String 类型）：/model/new 允许 model_info.id 传入任意字符串，
 * 未提供时由端点生成 uuid。
 */
export const LiteLLM_ProxyModelTable = pgTable("LiteLLM_ProxyModelTable", {
	model_id: text("model_id").primaryKey().notNull(),
	model_name: text("model_name").notNull(),
	litellm_params: jsonb("litellm_params").notNull(),
	model_info: jsonb("model_info"),
	created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	created_by: text("created_by").notNull(),
	updated_at: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updated_by: text("updated_by").notNull(),
});
