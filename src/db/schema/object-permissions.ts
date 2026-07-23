import { uuidText } from "./uuidText";
/**
 * LiteLLM_ObjectPermissionTable — object-level permissions
 * Prisma model: LiteLLM_ObjectPermissionTable (uuid PK)
 */

import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

export const LiteLLM_ObjectPermissionTable = pgTable("LiteLLM_ObjectPermissionTable", {
	objectPermissionId: uuidText("object_permission_id").primaryKey().notNull(),
	mcpServers: text("mcp_servers").array().default([]),
	mcpAccessGroups: text("mcp_access_groups").array().default([]),
	mcpToolPermissions: jsonb("mcp_tool_permissions"),
	vectorStores: text("vector_stores").array().default([]),
	agents: text("agents").array().default([]),
	agentAccessGroups: text("agent_access_groups").array().default([]),
	models: text("models").array().default([]),
	blockedTools: text("blocked_tools").array().default([]),
});
