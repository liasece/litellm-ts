import { pgTable, text, timestamp, jsonb, serial } from "drizzle-orm/pg-core";

/**
 * 模型表 - LiteLLM_ModelTable (自增主键, UNIQUE)
 */
export const LiteLLM_ModelTable = pgTable("LiteLLM_ModelTable", {
	id: serial("id").primaryKey(),
	model_aliases: jsonb("aliases"),
	created_at: timestamp("created_at").defaultNow(),
	created_by: text("created_by").notNull(),
	updated_at: timestamp("updated_at").defaultNow(),
	updated_by: text("updated_by").notNull(),
});
