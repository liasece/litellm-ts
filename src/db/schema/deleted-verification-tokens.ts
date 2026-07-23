import { uuidText } from "./uuidText";
/**
 * LiteLLM_DeletedVerificationToken — Audit copy of deleted verification tokens
 * Prisma model: LiteLLM_DeletedVerificationToken (UUID PK)
 */

import { doublePrecision, pgTable, text, integer, boolean, jsonb, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const liteLLM_DeletedVerificationToken = pgTable(
	"LiteLLM_DeletedVerificationToken",
	{
		id: uuidText("id").primaryKey().notNull(),
		token: text("token").notNull(),
		keyName: text("key_name"),
		keyAlias: text("key_alias"),
		softBudgetCooldown: boolean("soft_budget_cooldown").default(false).notNull(),
		spend: doublePrecision("spend").default(0.0).notNull(),
		expires: timestamp("expires", { precision: 3 }),
		models: text("models").array().notNull(),
		aliases: jsonb("aliases").default("{}").notNull(),
		config: jsonb("config").default("{}").notNull(),
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
		routerSettings: jsonb("router_settings").default("{}"),
		budgetId: text("budget_id"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		createdAt: timestamp("created_at", { precision: 3 }),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 }),
		updatedBy: text("updated_by"),
		lastActive: timestamp("last_active", { precision: 3 }),
		rotationCount: integer("rotation_count").default(0),
		autoRotate: boolean("auto_rotate").default(false),
		rotationInterval: text("rotation_interval"),
		lastRotationAt: timestamp("last_rotation_at", { precision: 3 }),
		keyRotationAt: timestamp("key_rotation_at", { precision: 3 }),
		// @map("deleted_at")
		deletedAt: timestamp("deleted_at", { precision: 3 }).defaultNow().notNull(),
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
