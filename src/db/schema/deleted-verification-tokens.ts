/**
 * LiteLLM_DeletedVerificationToken — Audit copy of deleted verification tokens
 * Prisma model: LiteLLM_DeletedVerificationToken (UUID PK)
 */

import { pgTable, text, uuid, real, integer, boolean, jsonb, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const liteLLM_DeletedVerificationToken = pgTable(
	"LiteLLM_DeletedVerificationToken",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		token: text("token").notNull(),
		keyName: text("key_name"),
		keyAlias: text("key_alias"),
		softBudgetCooldown: boolean("soft_budget_cooldown").default(false),
		spend: real("spend").default(0.0),
		expires: timestamp("expires"),
		models: text("models").array().notNull(),
		aliases: jsonb("aliases").default("{}"),
		config: jsonb("config").default("{}"),
		userId: text("user_id"),
		teamId: text("team_id"),
		agentId: text("agent_id"),
		projectId: text("project_id"),
		permissions: jsonb("permissions").default("{}"),
		maxParallelRequests: integer("max_parallel_requests"),
		metadata: jsonb("metadata").default("{}"),
		blocked: boolean("blocked"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		maxBudget: real("max_budget"),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at"),
		allowedCacheControls: text("allowed_cache_controls").array().default([]),
		allowedRoutes: text("allowed_routes").array().default([]),
		policies: text("policies").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		modelSpend: jsonb("model_spend").default("{}"),
		modelMaxBudget: jsonb("model_max_budget").default("{}"),
		routerSettings: jsonb("router_settings").default("{}"),
		budgetId: text("budget_id"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		createdAt: timestamp("created_at"),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at"),
		updatedBy: text("updated_by"),
		lastActive: timestamp("last_active"),
		rotationCount: integer("rotation_count").default(0),
		autoRotate: boolean("auto_rotate").default(false),
		rotationInterval: text("rotation_interval"),
		lastRotationAt: timestamp("last_rotation_at"),
		keyRotationAt: timestamp("key_rotation_at"),
		// @map("deleted_at")
		deletedAt: timestamp("deleted_at").defaultNow(),
		// @map("deleted_by")
		deletedBy: text("deleted_by"),
		// @map("deleted_by_api_key")
		deletedByApiKey: text("deleted_by_api_key"),
		// @map("litellm_changed_by")
		litellmChangedBy: text("litellm_changed_by"),
	},
	(table) => [
		index("deleted_verification_tokens_token_idx").on(table.token),
		index("deleted_verification_tokens_deleted_at_idx").on(table.deletedAt),
		index("deleted_verification_tokens_user_id_idx").on(table.userId),
		index("deleted_verification_tokens_team_id_idx").on(table.teamId),
		index("deleted_verification_tokens_organization_id_idx").on(table.organizationId),
		index("deleted_verification_tokens_key_alias_idx").on(table.keyAlias),
		index("deleted_verification_tokens_created_at_idx").on(table.createdAt),
	],
);
