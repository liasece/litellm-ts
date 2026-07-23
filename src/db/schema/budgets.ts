import { doublePrecision, pgTable, text, timestamp, integer, bigint, jsonb } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
/**
 * 预算表 - LiteLLM_BudgetTable
 */
export const LiteLLM_BudgetTable = pgTable("LiteLLM_BudgetTable", {
	budget_id: uuidText("budget_id").primaryKey().notNull(),
	max_budget: doublePrecision("max_budget"),
	soft_budget: doublePrecision("soft_budget"),
	max_parallel_requests: integer("max_parallel_requests"),
	tpm_limit: bigint("tpm_limit", { mode: "number" }),
	rpm_limit: bigint("rpm_limit", { mode: "number" }),
	model_max_budget: jsonb("model_max_budget"),
	budget_duration: text("budget_duration"),
	budget_reset_at: timestamp("budget_reset_at", { precision: 3 }),
	created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	created_by: text("created_by").notNull(),
	updated_at: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updated_by: text("updated_by").notNull(),
});
