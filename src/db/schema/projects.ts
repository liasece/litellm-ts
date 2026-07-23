import { uuidText } from "./uuidText";
/**
 * LiteLLM_ProjectTable — projects
 * Prisma model: LiteLLM_ProjectTable (uuid PK)
 */

import { doublePrecision, pgTable, text, boolean, jsonb, timestamp, bigint } from "drizzle-orm/pg-core";

export const LiteLLM_ProjectTable = pgTable("LiteLLM_ProjectTable", {
	projectId: uuidText("project_id").primaryKey().notNull(),
	projectAlias: text("project_alias"),
	description: text("description"),
	teamId: text("team_id"),
	budgetId: text("budget_id"),
	metadata: jsonb("metadata").default("{}").notNull(),
	models: text("models").array().notNull(),
	spend: doublePrecision("spend").default(0.0).notNull(),
	modelSpend: jsonb("model_spend").default("{}").notNull(),
	modelRpmLimit: jsonb("model_rpm_limit").default("{}").notNull(),
	modelTpmLimit: jsonb("model_tpm_limit").default("{}").notNull(),
	blocked: boolean("blocked").default(false).notNull(),
	objectPermissionId: text("object_permission_id"),
	// @map("created_at")
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	createdBy: text("created_by").notNull(),
	// @map("updated_at")
	updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updatedBy: text("updated_by").notNull(),
	/** PY: 项目级 TPM 限制（auth_checks.checkProjectAccess 需要） */
	tpmLimit: bigint("tpm_limit", { mode: "number" }),
	/** PY: 项目级 RPM 限制 */
	rpmLimit: bigint("rpm_limit", { mode: "number" }),
});
