import { doublePrecision, pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { LiteLLM_BudgetTable } from "./budgets";

/**
 * 标签表 - LiteLLM_TagTable (自然键 PK)
 */
export const LiteLLM_TagTable = pgTable("LiteLLM_TagTable", {
	tag_name: text("tag_name").notNull().primaryKey(),
	description: text("description"),
	models: text("models").array(),
	model_info: jsonb("model_info"),
	spend: doublePrecision("spend").default(0.0).notNull(),
	budget_id: text("budget_id").references(() => LiteLLM_BudgetTable.budget_id),
	created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	created_by: text("created_by"),
	updated_at: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	/** PY: 标签最大预算（auth_checks.checkTagBudget） */
	maxBudget: doublePrecision("max_budget"),
});
