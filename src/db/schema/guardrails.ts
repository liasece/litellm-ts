/**
 * LiteLLM_GuardrailsTable — Guardrail definitions
 * Prisma model: LiteLLM_GuardrailsTable (UUID PK, unique guardrail_name)
 */

import { pgTable, text, uuid, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_GuardrailsTable = pgTable(
	"LiteLLM_GuardrailsTable",
	{
		guardrailId: uuid("guardrail_id").defaultRandom().primaryKey(),
		guardrailName: text("guardrail_name").notNull(),
		litellmParams: jsonb("litellm_params").notNull(),
		guardrailInfo: jsonb("guardrail_info"),
		teamId: text("team_id"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
		status: text("status").default("active"),
		submittedAt: timestamp("submitted_at"),
		reviewedAt: timestamp("reviewed_at"),
	},
	(table) => [uniqueIndex("guardrails_guardrail_name_key").on(table.guardrailName), index("guardrails_status_idx").on(table.status)],
);
