import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * 配置覆盖表 - LiteLLM_ConfigOverrides (自然键 PK)
 */
export const LiteLLM_ConfigOverrides = pgTable("LiteLLM_ConfigOverrides", {
	config_type: text("config_type").notNull().primaryKey(),
	config_value: jsonb("config_value").notNull(),
	created_at: timestamp("created_at").defaultNow(),
	updated_at: timestamp("updated_at").defaultNow(),
});
