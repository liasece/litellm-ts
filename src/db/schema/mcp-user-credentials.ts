import { uuidText } from "./uuidText";
/**
 * LiteLLM_MCPUserCredentials — Per-user MCP server credentials
 * Prisma model: LiteLLM_MCPUserCredentials (UUID PK, unique on [user_id, server_id])
 */

import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_MCPUserCredentials = pgTable(
	"LiteLLM_MCPUserCredentials",
	{
		id: uuidText("id").primaryKey().notNull(),
		userId: text("user_id").notNull(),
		serverId: text("server_id").notNull(),
		credentialB64: text("credential_b64").notNull(),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex("mcp_user_credentials_user_server_key").on(table.userId, table.serverId)],
);
