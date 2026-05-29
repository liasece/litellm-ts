/**
 * LiteLLM_AccessGroupTable — access groups
 * Prisma model: LiteLLM_AccessGroupTable (uuid PK)
 */

import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const LiteLLM_AccessGroupTable = pgTable(
	"LiteLLM_AccessGroupTable",
	{
		accessGroupId: uuid("access_group_id").defaultRandom().primaryKey(),
		accessGroupName: text("access_group_name").notNull(),
		description: text("description"),
		accessModelNames: text("access_model_names").array().default([]),
		accessMcpServerIds: text("access_mcp_server_ids").array().default([]),
		accessAgentIds: text("access_agent_ids").array().default([]),
		assignedTeamIds: text("assigned_team_ids").array().default([]),
		assignedKeyIds: text("assigned_key_ids").array().default([]),
		createdAt: timestamp("created_at").defaultNow(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at").defaultNow(),
		updatedBy: text("updated_by"),
	},
	(table) => [uniqueIndex("access_group_name_key").on(table.accessGroupName)],
);
