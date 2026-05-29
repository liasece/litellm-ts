import { pgTable, text, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { LiteLLM_BudgetTable } from "./budgets";

/**
 * 标签表 - LiteLLM_TagTable (自然键 PK)
 */
export const LiteLLM_TagTable = pgTable("LiteLLM_TagTable", {
	tag_name: text("tag_name").notNull().primaryKey(),
	description: text("description"),
	models: text("models").array().notNull(),
	model_info: jsonb("model_info"),
	spend: real("spend").default(0.0),
	budget_id: text("budget_id").references(() => LiteLLM_BudgetTable.budget_id),
	created_at: timestamp("created_at").defaultNow(),
	created_by: text("created_by"),
	updated_at: timestamp("updated_at").defaultNow(),
});
