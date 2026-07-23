import { uuidText } from "./uuidText";
/**
 * LiteLLM_DeletedTeamTable — Audit copy of deleted teams
 * Prisma model: LiteLLM_DeletedTeamTable (UUID PK)
 */

import { doublePrecision, pgTable, text, integer, boolean, jsonb, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const liteLLM_DeletedTeamTable = pgTable(
	"LiteLLM_DeletedTeamTable",
	{
		id: uuidText("id").primaryKey().notNull(),
		teamId: text("team_id").notNull(),
		teamAlias: text("team_alias"),
		organizationId: text("organization_id"),
		objectPermissionId: text("object_permission_id"),
		admins: text("admins").array().notNull(),
		members: text("members").array().notNull(),
		membersWithRoles: jsonb("members_with_roles").default("{}").notNull(),
		metadata: jsonb("metadata").default("{}").notNull(),
		maxBudget: doublePrecision("max_budget"),
		softBudget: doublePrecision("soft_budget"),
		spend: doublePrecision("spend").default(0.0).notNull(),
		models: text("models").array().notNull(),
		maxParallelRequests: integer("max_parallel_requests"),
		tpmLimit: bigint("tpm_limit", { mode: "number" }),
		rpmLimit: bigint("rpm_limit", { mode: "number" }),
		budgetDuration: text("budget_duration"),
		budgetResetAt: timestamp("budget_reset_at", { precision: 3 }),
		blocked: boolean("blocked").default(false).notNull(),
		modelSpend: jsonb("model_spend").default("{}").notNull(),
		modelMaxBudget: jsonb("model_max_budget").default("{}").notNull(),
		routerSettings: jsonb("router_settings").default("{}"),
		teamMemberPermissions: text("team_member_permissions").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		policies: text("policies").array().default([]),
		modelId: integer("model_id"),
		allowTeamGuardrailConfig: boolean("allow_team_guardrail_config").default(false).notNull(),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }),
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
		index("deleted_teams_team_id_idx").on(table.teamId),
		index("deleted_teams_deleted_at_idx").on(table.deletedAt),
		index("deleted_teams_organization_id_idx").on(table.organizationId),
		index("deleted_teams_team_alias_idx").on(table.teamAlias),
		index("deleted_teams_created_at_idx").on(table.createdAt),
	],
);
