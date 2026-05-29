import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

/**
 * 配置表 - LiteLLM_Config (自然键 PK)
 */
export const LiteLLM_Config = pgTable("LiteLLM_Config", {
	param_name: text("param_name").notNull().primaryKey(),
	param_value: jsonb("param_value"),
});
