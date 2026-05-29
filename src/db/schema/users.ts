/**
 * LiteLLM_UserTable — API users
 * Prisma model: LiteLLM_UserTable (natural key PK)
 */

import { pgTable, text, real, integer, boolean, jsonb, timestamp, bigint, uniqueIndex } from "drizzle-orm/pg-core";

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
		maxBudget: real("max_budget"),
		spend: real("spend").default(0.0),
		userEmail: text("user_email"),
		models: text("models").array().notNull(),
		metadata: jsonb("metadata").default("{}"),
		maxParallelRequests: integer("max_parallel_requests"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at"),
		allowedCacheControls: text("allowed_cache_controls").array().default([]),
		policies: text("policies").array().default([]),
		modelSpend: jsonb("model_spend").default("{}"),
		modelMaxBudget: jsonb("model_max_budget").default("{}"),
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [uniqueIndex("user_sso_user_id_key").on(table.ssoUserId)],
);
