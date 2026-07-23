/**
 * LiteLLM_UserTable — API users
 * Prisma model: LiteLLM_UserTable (natural key PK)
 */

import { doublePrecision, pgTable, text, integer, boolean, jsonb, timestamp, bigint, uniqueIndex } from "drizzle-orm/pg-core";

export const LiteLLM_UserTable = pgTable(
	"LiteLLM_UserTable",
	{
		userId: text("user_id").notNull().primaryKey(),
		userAlias: text("user_alias"),
		teamId: text("team_id"),
		ssoUserId: text("sso_user_id"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		password: text("password"),
		teams: text("teams").array().default([]),
		userRole: text("user_role"),
		maxBudget: doublePrecision("max_budget"),
		spend: doublePrecision("spend").default(0.0).notNull(),
		userEmail: text("user_email"),
		models: text("models").array().notNull(),
		metadata: jsonb("metadata").default("{}").notNull(),
		maxParallelRequests: integer("max_parallel_requests"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at", { precision: 3 }),
		allowedCacheControls: text("allowed_cache_controls").array().default([]),
		policies: text("policies").array().default([]),
		modelSpend: jsonb("model_spend").default("{}").notNull(),
		modelMaxBudget: jsonb("model_max_budget").default("{}").notNull(),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow(),
	},
	(table) => [uniqueIndex("user_sso_user_id_key").on(table.ssoUserId)],
);
