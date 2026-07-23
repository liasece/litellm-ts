import { uuidText } from "./uuidText";
/**
 * LiteLLM_PromptTable — Versioned prompt definitions
 * Prisma model: LiteLLM_PromptTable (UUID PK, unique on [prompt_id, version])
 */

import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_PromptTable = pgTable(
	"LiteLLM_PromptTable",
	{
		id: uuidText("id").primaryKey().notNull(),
		promptId: text("prompt_id").notNull(),
		version: integer("version").default(1).notNull(),
		litellmParams: jsonb("litellm_params").notNull(),
		promptInfo: jsonb("prompt_info"),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("prompts_prompt_id_version_key").on(table.promptId, table.version),
		index("prompts_prompt_id_idx").on(table.promptId),
	],
);
