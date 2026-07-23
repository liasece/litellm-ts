import { uuidText } from "./uuidText";
/**
 * LiteLLM_ToolTable — Tool definitions
 * Prisma model: LiteLLM_ToolTable (UUID PK, unique tool_name)
 */

import { pgTable, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_ToolTable = pgTable(
	"LiteLLM_ToolTable",
	{
		toolId: uuidText("tool_id").primaryKey().notNull(),
		toolName: text("tool_name").notNull(),
		origin: text("origin"),
		inputPolicy: text("input_policy").default("untrusted").notNull(),
		outputPolicy: text("output_policy").default("untrusted").notNull(),
		callCount: integer("call_count").default(0).notNull(),
		assignments: jsonb("assignments").default("{}"),
		keyHash: text("key_hash"),
		teamId: text("team_id"),
		keyAlias: text("key_alias"),
		userAgent: text("user_agent"),
		lastUsedAt: timestamp("last_used_at", { precision: 3 }),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("tools_tool_name_key").on(table.toolName),
		index("tools_input_policy_idx").on(table.inputPolicy),
		index("tools_output_policy_idx").on(table.outputPolicy),
		index("tools_team_id_idx").on(table.teamId),
	],
);
