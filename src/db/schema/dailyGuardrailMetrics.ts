import { pgTable, text, real, bigint, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const liteLLM_DailyGuardrailMetrics = pgTable(
	"LiteLLM_DailyGuardrailMetrics",
	{
		guardrail_id: text("guardrail_id").notNull(),
		date: text("date").notNull(),
		requests_evaluated: bigint("requests_evaluated", { mode: "number" }).default(0),
		passed_count: bigint("passed_count", { mode: "number" }).default(0),
		blocked_count: bigint("blocked_count", { mode: "number" }).default(0),
		flagged_count: bigint("flagged_count", { mode: "number" }).default(0),
		avg_score: real("avg_score"),
		avg_latency_ms: real("avg_latency_ms"),
		created_at: timestamp("created_at").defaultNow(),
		updated_at: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.guardrail_id, table.date] }),
		dateIdx: index("daily_guardrail_metrics_date").on(table.date),
		guardrailIdx: index("daily_guardrail_metrics_guardrail_id").on(table.guardrail_id),
	}),
);
