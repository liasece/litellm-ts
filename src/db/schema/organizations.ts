/**
 * LiteLLM_OrganizationTable — organizations
 * Prisma model: LiteLLM_OrganizationTable (uuid PK)
 */

import { doublePrecision, pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_OrganizationTable = pgTable("LiteLLM_OrganizationTable", {
	organizationId: text("organization_id").primaryKey().notNull(),
	organizationAlias: text("organization_alias").notNull(),
	budgetId: text("budget_id").notNull(),
	metadata: jsonb("metadata").default("{}").notNull(),
	models: text("models").array().notNull(),
	spend: doublePrecision("spend").default(0.0).notNull(),
	modelSpend: jsonb("model_spend").default("{}").notNull(),
	objectPermissionId: text("object_permission_id"),
	// @map("created_at")
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	createdBy: text("created_by").notNull(),
	// @map("updated_at")
	updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updatedBy: text("updated_by").notNull(),
});
