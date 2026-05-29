/**
 * LiteLLM_DeletedTeamTable — Audit copy of deleted teams
 * Prisma model: LiteLLM_DeletedTeamTable (UUID PK)
 */

import { pgTable, text, uuid, real, integer, boolean, jsonb, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const liteLLM_DeletedTeamTable = pgTable(
	"LiteLLM_DeletedTeamTable",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		teamId: text("team_id").notNull(),
		teamAlias: text("team_alias"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		admins: text("admins").array().notNull(),
		members: text("members").array().notNull(),
		membersWithRoles: jsonb("members_with_roles").default("{}"),
		metadata: jsonb("metadata").default("{}"),
		maxBudget: real("max_budget"),
		softBudget: real("soft_budget"),
		spend: real("spend").default(0.0),
		models: text("models").array().notNull(),
		maxParallelRequests: integer("max_parallel_requests"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at"),
		blocked: boolean("blocked").default(false),
		modelSpend: jsonb("model_spend").default("{}"),
		modelMaxBudget: jsonb("model_max_budget").default("{}"),
		routerSettings: jsonb("router_settings").default("{}"),
		teamMemberPermissions: text("team_member_permissions").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		policies: text("policies").array().default([]),
		modelId: integer("model_id"),
		allowTeamGuardrailConfig: boolean("allow_team_guardrail_config").default(false),
		// @map("created_at")
		createdAt: timestamp("created_at"),
		// @map("updated_at")
		updatedAt: timestamp("updated_at"),
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
		index("deleted_teams_team_id_idx").on(table.teamId),
		index("deleted_teams_deleted_at_idx").on(table.deletedAt),
		index("deleted_teams_organization_id_idx").on(table.organizationId),
		index("deleted_teams_team_alias_idx").on(table.teamAlias),
		index("deleted_teams_created_at_idx").on(table.createdAt),
	],
);
