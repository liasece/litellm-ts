/**
 * LiteLLM_TeamTable — teams
 * Prisma model: LiteLLM_TeamTable (uuid PK)
 */

import { doublePrecision, pgTable, text, integer, boolean, jsonb, timestamp, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";

export const LiteLLM_TeamTable = pgTable(
	"LiteLLM_TeamTable",
	{
		teamId: text("team_id").primaryKey().notNull(),
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
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
		modelSpend: jsonb("model_spend").default("{}").notNull(),
		modelMaxBudget: jsonb("model_max_budget").default("{}").notNull(),
		routerSettings: jsonb("router_settings").default("{}"),
		teamMemberPermissions: text("team_member_permissions").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		policies: text("policies").array().default([]),
		modelId: integer("model_id"),
		allowTeamGuardrailConfig: boolean("allow_team_guardrail_config").default(false).notNull(),
	},
	(table) => [
		index("team_organization_idx").on(table.organizationId),
		index("team_alias_idx").on(table.teamAlias),
		index("team_created_at_idx").on(table.createdAt),
		uniqueIndex("team_model_id_key").on(table.modelId),
	],
);
