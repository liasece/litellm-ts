import { uuidText } from "./uuidText";
/**
 * LiteLLM_PolicyTable — Versioned policy definitions
 * Prisma model: LiteLLM_PolicyTable (UUID PK, unique on [policy_name, version_number])
 */

import { pgTable, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_PolicyTable = pgTable(
	"LiteLLM_PolicyTable",
	{
		policyId: uuidText("policy_id").primaryKey().notNull(),
		policyName: text("policy_name").notNull(),
		versionNumber: integer("version_number").default(1).notNull(),
		versionStatus: text("version_status").default("production").notNull(),
		parentVersionId: text("parent_version_id"),
		isLatest: boolean("is_latest").default(true).notNull(),
		publishedAt: timestamp("published_at", { precision: 3 }),
		productionAt: timestamp("production_at", { precision: 3 }),
		inherit: text("inherit"),
		description: text("description"),
		guardrailsAdd: text("guardrails_add").array().default([]),
		guardrailsRemove: text("guardrails_remove").array().default([]),
		condition: jsonb("condition").default("{}"),
		pipeline: jsonb("pipeline"),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("policies_policy_name_version_number_key").on(table.policyName, table.versionNumber),
		index("policies_policy_name_idx").on(table.policyName),
		index("policies_version_status_idx").on(table.versionStatus),
	],
);
