import { uuidText } from "./uuidText";
/**
 * LiteLLM_GuardrailsTable — Guardrail definitions
 * Prisma model: LiteLLM_GuardrailsTable (UUID PK, unique guardrail_name)
 */

import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_GuardrailsTable = pgTable(
	"LiteLLM_GuardrailsTable",
	{
		guardrailId: uuidText("guardrail_id").primaryKey().notNull(),
		guardrailName: text("guardrail_name").notNull(),
		litellmParams: jsonb("litellm_params").notNull(),
		guardrailInfo: jsonb("guardrail_info"),
		teamId: text("team_id"),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
		status: text("status").default("active").notNull(),
		submittedAt: timestamp("submitted_at", { precision: 3 }),
		reviewedAt: timestamp("reviewed_at", { precision: 3 }),
	},
	(table) => [uniqueIndex("guardrails_guardrail_name_key").on(table.guardrailName), index("guardrails_status_idx").on(table.status)],
);
