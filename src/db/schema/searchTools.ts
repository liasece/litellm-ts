import { pgTable, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
/**
 * 搜索工具表 - LiteLLM_SearchToolsTable
 */
export const LiteLLM_SearchToolsTable = pgTable(
	"LiteLLM_SearchToolsTable",
	{
		search_tool_id: uuidText("search_tool_id").primaryKey().notNull(),
		search_tool_name: text("search_tool_name").notNull(),
		litellm_params: jsonb("litellm_params").notNull(),
		search_tool_info: jsonb("search_tool_info"),
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [uniqueIndex("idx_search_tool_name").on(table.search_tool_name)],
);
