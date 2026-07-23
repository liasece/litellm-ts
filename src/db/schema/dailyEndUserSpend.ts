import { doublePrecision, pgTable, text, bigint, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
export const liteLLM_DailyEndUserSpend = pgTable(
	"LiteLLM_DailyEndUserSpend",
	{
		id: uuidText("id").primaryKey().notNull(),
		end_user_id: text("end_user_id"),
		date: text("date").notNull(),
		api_key: text("api_key").notNull(),
		model: text("model"),
		model_group: text("model_group"),
		custom_llm_provider: text("custom_llm_provider"),
		mcp_namespaced_tool_name: text("mcp_namespaced_tool_name"),
		endpoint: text("endpoint"),
		prompt_tokens: bigint("prompt_tokens", { mode: "number" }).default(0).notNull(),
		completion_tokens: bigint("completion_tokens", { mode: "number" }).default(0).notNull(),
		cache_read_input_tokens: bigint("cache_read_input_tokens", { mode: "number" }).default(0).notNull(),
		cache_creation_input_tokens: bigint("cache_creation_input_tokens", { mode: "number" }).default(0).notNull(),
		spend: doublePrecision("spend").default(0.0).notNull(),
		api_requests: bigint("api_requests", { mode: "number" }).default(0).notNull(),
		successful_requests: bigint("successful_requests", { mode: "number" }).default(0).notNull(),
		failed_requests: bigint("failed_requests", { mode: "number" }).default(0).notNull(),
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		unq: uniqueIndex("daily_end_user_spend_unique").on(
			table.end_user_id,
			table.date,
			table.api_key,
			table.model,
			table.custom_llm_provider,
			table.mcp_namespaced_tool_name,
			table.endpoint,
		),
		dateIdx: index("daily_end_user_spend_date").on(table.date),
		endUserDateIdx: index("daily_end_user_spend_end_user_date").on(table.end_user_id, table.date),
		apiKeyIdx: index("daily_end_user_spend_api_key").on(table.api_key),
		modelIdx: index("daily_end_user_spend_model").on(table.model),
		mcpToolIdx: index("daily_end_user_spend_mcp_namespaced_tool_name").on(table.mcp_namespaced_tool_name),
		endpointIdx: index("daily_end_user_spend_endpoint").on(table.endpoint),
	}),
);
