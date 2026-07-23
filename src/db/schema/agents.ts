import { uuidText } from "./uuidText";
/**
 * LiteLLM_AgentsTable — AI agent definitions
 * Prisma model: LiteLLM_AgentsTable (UUID PK)
 */

import { doublePrecision, pgTable, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_AgentsTable = pgTable(
	"LiteLLM_AgentsTable",
	{
		agentId: uuidText("agent_id").primaryKey().notNull(),
		agentName: text("agent_name").notNull(),
		litellmParams: jsonb("litellm_params"),
		agentCardParams: jsonb("agent_card_params").notNull(),
		staticHeaders: jsonb("static_headers").default("{}"),
		extraHeaders: text("extra_headers").array().default([]),
		agentAccessGroups: text("agent_access_groups").array().default([]),
		objectPermissionId: text("object_permission_id"),
		spend: doublePrecision("spend").default(0.0).notNull(),
		tpmLimit: integer("tpm_limit"),
		rpmLimit: integer("rpm_limit"),
		sessionTpmLimit: integer("session_tpm_limit"),
		sessionRpmLimit: integer("session_rpm_limit"),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by").notNull(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [uniqueIndex("agents_agent_name_key").on(table.agentName)],
);
