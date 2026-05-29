/**
 * LiteLLM_PromptTable — Versioned prompt definitions
 * Prisma model: LiteLLM_PromptTable (UUID PK, unique on [prompt_id, version])
 */

import { pgTable, text, uuid, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_PromptTable = pgTable(
	"LiteLLM_PromptTable",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		promptId: text("prompt_id").notNull(),
		version: integer("version").default(1),
		litellmParams: jsonb("litellm_params").notNull(),
		promptInfo: jsonb("prompt_info"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		uniqueIndex("prompts_prompt_id_version_key").on(table.promptId, table.version),
		index("prompts_prompt_id_idx").on(table.promptId),
	],
);
