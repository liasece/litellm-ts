import { doublePrecision, pgTable, text, bigint, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const liteLLM_DailyPolicyMetrics = pgTable(
	"LiteLLM_DailyPolicyMetrics",
	{
		policy_id: text("policy_id").notNull(),
		date: text("date").notNull(),
		requests_evaluated: bigint("requests_evaluated", { mode: "number" }).default(0).notNull(),
		passed_count: bigint("passed_count", { mode: "number" }).default(0).notNull(),
		blocked_count: bigint("blocked_count", { mode: "number" }).default(0).notNull(),
		flagged_count: bigint("flagged_count", { mode: "number" }).default(0).notNull(),
		avg_score: doublePrecision("avg_score"),
		avg_latency_ms: doublePrecision("avg_latency_ms"),
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.policy_id, table.date] }),
		dateIdx: index("daily_policy_metrics_date").on(table.date),
		policyIdx: index("daily_policy_metrics_policy_id").on(table.policy_id),
	}),
);
