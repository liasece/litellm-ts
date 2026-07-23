import { doublePrecision, pgTable, text, bigint, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const liteLLM_DailyGuardrailMetrics = pgTable(
	"LiteLLM_DailyGuardrailMetrics",
	{
		guardrail_id: text("guardrail_id").notNull(),
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
		pk: primaryKey({ columns: [table.guardrail_id, table.date] }),
		dateIdx: index("daily_guardrail_metrics_date").on(table.date),
		guardrailIdx: index("daily_guardrail_metrics_guardrail_id").on(table.guardrail_id),
	}),
);
