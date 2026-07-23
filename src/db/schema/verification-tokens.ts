/**
 * LiteLLM_VerificationToken — API key verification tokens
 * Prisma model: LiteLLM_VerificationToken (natural key PK — hash of API key)
 */

import { doublePrecision, pgTable, text, integer, boolean, jsonb, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const LiteLLM_VerificationToken = pgTable(
	"LiteLLM_VerificationToken",
	{
		token: text("token").notNull().primaryKey(),
		keyName: text("key_name"),
		keyAlias: text("key_alias"),
		softBudgetCooldown: boolean("soft_budget_cooldown").default(false).notNull(),
		spend: doublePrecision("spend").default(0.0).notNull(),
		expires: timestamp("expires", { precision: 3 }),
		models: text("models").array().notNull(),
		aliases: jsonb("aliases").default("{}").notNull(),
		config: jsonb("config").default("{}").notNull(),
		routerSettings: jsonb("router_settings").default("{}"),
		userId: text("user_id"),
		teamId: text("team_id"),
		agentId: text("agent_id"),
		projectId: text("project_id"),
		permissions: jsonb("permissions").default("{}").notNull(),
		maxParallelRequests: integer("max_parallel_requests"),
		metadata: jsonb("metadata").default("{}").notNull(),
		blocked: boolean("blocked"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		maxBudget: doublePrecision("max_budget"),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at", { precision: 3 }),
		allowedCacheControls: text("allowed_cache_controls").array().default([]),
		allowedRoutes: text("allowed_routes").array().default([]),
		policies: text("policies").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		modelSpend: jsonb("model_spend").default("{}").notNull(),
		modelMaxBudget: jsonb("model_max_budget").default("{}").notNull(),
		budgetId: text("budget_id"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow(),
		createdBy: text("created_by"),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow(),
		updatedBy: text("updated_by"),
		lastActive: timestamp("last_active", { precision: 3 }),
		rotationCount: integer("rotation_count").default(0),
		autoRotate: boolean("auto_rotate").default(false),
		rotationInterval: text("rotation_interval"),
		lastRotationAt: timestamp("last_rotation_at", { precision: 3 }),
		keyRotationAt: timestamp("key_rotation_at", { precision: 3 }),
	},
	(table) => [
		index("verification_token_user_team_idx").on(table.userId, table.teamId),
		index("verification_token_team_idx").on(table.teamId),
		index("verification_token_budget_reset_expires_idx").on(table.budgetResetAt, table.expires),
	],
);
