/**
 * LiteLLM_MCPUserCredentials — Per-user MCP server credentials
 * Prisma model: LiteLLM_MCPUserCredentials (UUID PK, unique on [user_id, server_id])
 */

import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_MCPUserCredentials = pgTable(
	"LiteLLM_MCPUserCredentials",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id").notNull(),
		serverId: text("server_id").notNull(),
		credentialB64: text("credential_b64").notNull(),
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [uniqueIndex("mcp_user_credentials_user_server_key").on(table.userId, table.serverId)],
);
