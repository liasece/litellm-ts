import { uuidText } from "./uuidText";
/**
 * LiteLLM_MCPServerTable — MCP server configurations
 * Prisma model: LiteLLM_MCPServerTable (UUID PK)
 */

import { pgTable, text, boolean, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const liteLLM_MCPServerTable = pgTable("LiteLLM_MCPServerTable", {
	serverId: uuidText("server_id").primaryKey().notNull(),
	serverName: text("server_name"),
	alias: text("alias"),
	description: text("description"),
	url: text("url"),
	specPath: text("spec_path"),
	transport: text("transport").default("sse").notNull(),
	authType: text("auth_type"),
	credentials: jsonb("credentials").default("{}"),
	// @map("created_at")
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow(),
	createdBy: text("created_by"),
	// @map("updated_at")
	updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow(),
	updatedBy: text("updated_by"),
	mcpInfo: jsonb("mcp_info").default("{}"),
	mcpAccessGroups: text("mcp_access_groups").array().notNull(),
	allowedTools: text("allowed_tools").array().default([]),
	toolNameToDisplayName: jsonb("tool_name_to_display_name").default("{}"),
	toolNameToDescription: jsonb("tool_name_to_description").default("{}"),
	extraHeaders: text("extra_headers").array().default([]),
	staticHeaders: jsonb("static_headers").default("{}"),
	status: text("status").default("unknown"),
	lastHealthCheck: timestamp("last_health_check", { precision: 3 }),
	healthCheckError: text("health_check_error"),
	command: text("command"),
	args: text("args").array().default([]),
	env: jsonb("env").default("{}"),
	authorizationUrl: text("authorization_url"),
	tokenUrl: text("token_url"),
	registrationUrl: text("registration_url"),
	allowAllKeys: boolean("allow_all_keys").default(false).notNull(),
	availableOnPublicInternet: boolean("available_on_public_internet").default(true).notNull(),
	isByok: boolean("is_byok").default(false).notNull(),
	byokDescription: text("byok_description").array().default([]),
	byokApiKeyHelpUrl: text("byok_api_key_help_url"),
});
