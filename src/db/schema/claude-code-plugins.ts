/**
 * LiteLLM_ClaudeCodePluginTable — Claude Code plugin definitions
 * Prisma model: LiteLLM_ClaudeCodePluginTable (UUID PK, unique name)
 */

import { pgTable, text, uuid, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_ClaudeCodePluginTable = pgTable(
	"LiteLLM_ClaudeCodePluginTable",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		version: text("version"),
		description: text("description"),
		manifestJson: text("manifest_json"),
		filesJson: text("files_json").default("{}"),
		enabled: boolean("enabled").default(true),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
		createdBy: text("created_by"),
	},
	(table) => [uniqueIndex("claude_code_plugins_name_key").on(table.name)],
);
