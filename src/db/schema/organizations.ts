/**
 * LiteLLM_OrganizationTable — organizations
 * Prisma model: LiteLLM_OrganizationTable (uuid PK)
 */

import { pgTable, text, uuid, real, jsonb, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_OrganizationTable = pgTable("LiteLLM_OrganizationTable", {
	organizationId: uuid("organization_id").defaultRandom().primaryKey(),
	organizationAlias: text("organization_alias").notNull(),
	budgetId: text("budget_id").notNull(),
	metadata: jsonb("metadata").default("{}"),
	models: text("models").array().notNull(),
	spend: real("spend").default(0.0),
	modelSpend: jsonb("model_spend").default("{}"),
	objectPermissionId: text("object_permission_id"),
	// @map("created_at")
	createdAt: timestamp("created_at").defaultNow(),
	createdBy: text("created_by").notNull(),
	// @map("updated_at")
	updatedAt: timestamp("updated_at").defaultNow(),
	updatedBy: text("updated_by").notNull(),
});
