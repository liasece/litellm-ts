/**
 * LiteLLM_TeamTable — teams
 * Prisma model: LiteLLM_TeamTable (uuid PK)
 */

import { pgTable, text, uuid, real, integer, boolean, jsonb, timestamp, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";

export const LiteLLM_TeamTable = pgTable(
	"LiteLLM_TeamTable",
	{
		teamId: uuid("team_id").defaultRandom().primaryKey(),
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
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at").defaultNow(),
		modelSpend: jsonb("model_spend").default("{}"),
		modelMaxBudget: jsonb("model_max_budget").default("{}"),
		routerSettings: jsonb("router_settings").default("{}"),
		teamMemberPermissions: text("team_member_permissions").array().default([]),
		accessGroupIds: text("access_group_ids").array().default([]),
		policies: text("policies").array().default([]),
		modelId: integer("model_id"),
		allowTeamGuardrailConfig: boolean("allow_team_guardrail_config").default(false),
	},
	(table) => [
		index("team_organization_idx").on(table.organizationId),
		index("team_alias_idx").on(table.teamAlias),
		index("team_created_at_idx").on(table.createdAt),
		uniqueIndex("team_model_id_key").on(table.modelId),
	],
);
