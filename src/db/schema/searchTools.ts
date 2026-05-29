import { pgTable, text, timestamp, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 搜索工具表 - LiteLLM_SearchToolsTable
 */
export const LiteLLM_SearchToolsTable = pgTable(
	"LiteLLM_SearchToolsTable",
	{
		search_tool_id: uuid("search_tool_id").defaultRandom().primaryKey(),
		search_tool_name: text("search_tool_name").notNull(),
		litellm_params: jsonb("litellm_params").notNull(),
		search_tool_info: jsonb("search_tool_info"),
		created_at: timestamp("created_at").defaultNow(),
		updated_at: timestamp("updated_at").defaultNow(),
	},
	(table) => [uniqueIndex("idx_search_tool_name").on(table.search_tool_name)],
);
