/**
 * LiteLLM_AgentsTable — AI agent definitions
 * Prisma model: LiteLLM_AgentsTable (UUID PK)
 */

import { pgTable, text, uuid, real, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_AgentsTable = pgTable(
	"LiteLLM_AgentsTable",
	{
		agentId: uuid("agent_id").defaultRandom().primaryKey(),
		agentName: text("agent_name").notNull(),
		litellmParams: jsonb("litellm_params"),
		agentCardParams: jsonb("agent_card_params").notNull(),
		staticHeaders: jsonb("static_headers").default("{}"),
		extraHeaders: text("extra_headers").array().default([]),
		agentAccessGroups: text("agent_access_groups").array().default([]),
		objectPermissionId: text("object_permission_id"),
		spend: real("spend").default(0.0),
		tpmLimit: integer("tpm_limit"),
		rpmLimit: integer("rpm_limit"),
		sessionTpmLimit: integer("session_tpm_limit"),
		sessionRpmLimit: integer("session_rpm_limit"),
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
		createdBy: text("created_by").notNull(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at").defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [uniqueIndex("agents_agent_name_key").on(table.agentName)],
);
