import { pgTable, text, timestamp, real, integer, bigint, jsonb, uuid } from "drizzle-orm/pg-core";

/**
 * 预算表 - LiteLLM_BudgetTable
 */
export const LiteLLM_BudgetTable = pgTable("LiteLLM_BudgetTable", {
	budget_id: uuid("budget_id").defaultRandom().primaryKey(),
	max_budget: real("max_budget"),
	soft_budget: real("soft_budget"),
	max_parallel_requests: integer("max_parallel_requests"),
	tpm_limit: bigint("tpm_limit", { mode: "number" }),
	rpm_limit: bigint("rpm_limit", { mode: "number" }),
	model_max_budget: jsonb("model_max_budget"),
	budget_duration: text("budget_duration"),
	budget_reset_at: timestamp("budget_reset_at"),
	created_at: timestamp("created_at").defaultNow(),
	created_by: text("created_by").notNull(),
	updated_at: timestamp("updated_at").defaultNow(),
	updated_by: text("updated_by").notNull(),
});
