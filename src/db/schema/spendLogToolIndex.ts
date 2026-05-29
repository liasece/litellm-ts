import { pgTable, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const liteLLM_SpendLogToolIndex = pgTable(
	"LiteLLM_SpendLogToolIndex",
	{
		request_id: text("request_id").notNull(),
		tool_name: text("tool_name").notNull(),
		start_time: timestamp("start_time").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.request_id, table.tool_name] }),
		toolStartIdx: index("spend_log_tool_index_tool_start").on(table.tool_name, table.start_time),
	}),
);
