import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * UI 设置表 - LiteLLM_UISettings (固定单行表)
 */
export const LiteLLM_UISettings = pgTable("LiteLLM_UISettings", {
	id: text("id").default("ui_settings").primaryKey(),
	ui_settings: jsonb("ui_settings").notNull(),
	created_at: timestamp("created_at").defaultNow(),
	updated_at: timestamp("updated_at").defaultNow(),
});
