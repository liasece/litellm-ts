import { pgTable, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const liteLLM_SpendLogGuardrailIndex = pgTable(
	"LiteLLM_SpendLogGuardrailIndex",
	{
		request_id: text("request_id").notNull(),
		guardrail_id: text("guardrail_id").notNull(),
		policy_id: text("policy_id"),
		start_time: timestamp("start_time").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.request_id, table.guardrail_id] }),
		guardrailStartIdx: index("spend_log_guardrail_index_guardrail_start").on(table.guardrail_id, table.start_time),
		policyStartIdx: index("spend_log_guardrail_index_policy_start").on(table.policy_id, table.start_time),
	}),
);
