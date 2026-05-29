import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

/**
 * 代理模型表 - LiteLLM_ProxyModelTable
 */
export const LiteLLM_ProxyModelTable = pgTable("LiteLLM_ProxyModelTable", {
	model_id: uuid("model_id").defaultRandom().primaryKey(),
	model_name: text("model_name").notNull(),
	litellm_params: jsonb("litellm_params").notNull(),
	model_info: jsonb("model_info"),
	created_at: timestamp("created_at").defaultNow(),
	created_by: text("created_by").notNull(),
	updated_at: timestamp("updated_at").defaultNow(),
	updated_by: text("updated_by").notNull(),
});
