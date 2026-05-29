/**
 * LiteLLM_ProjectTable — projects
 * Prisma model: LiteLLM_ProjectTable (uuid PK)
 */

import { pgTable, text, uuid, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_ProjectTable = pgTable("LiteLLM_ProjectTable", {
	projectId: uuid("project_id").defaultRandom().primaryKey(),
	projectAlias: text("project_alias"),
	description: text("description"),
	teamId: text("team_id"),
	budgetId: text("budget_id"),
	metadata: jsonb("metadata").default("{}"),
	models: text("models").array().notNull(),
	spend: real("spend").default(0.0),
	modelSpend: jsonb("model_spend").default("{}"),
	modelRpmLimit: jsonb("model_rpm_limit").default("{}"),
	modelTpmLimit: jsonb("model_tpm_limit").default("{}"),
	blocked: boolean("blocked").default(false),
	objectPermissionId: text("object_permission_id"),
	// @map("created_at")
	createdAt: timestamp("created_at").defaultNow(),
	createdBy: text("created_by").notNull(),
	// @map("updated_at")
	updatedAt: timestamp("updated_at").defaultNow(),
	updatedBy: text("updated_by").notNull(),
});
