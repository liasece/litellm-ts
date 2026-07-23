import { pgTable, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
/**
 * 凭证表 - LiteLLM_CredentialsTable
 */
export const LiteLLM_CredentialsTable = pgTable(
	"LiteLLM_CredentialsTable",
	{
		credential_id: uuidText("credential_id").primaryKey().notNull(),
		credential_name: text("credential_name").notNull(),
		credential_values: jsonb("credential_values").notNull(),
		credential_info: jsonb("credential_info"),
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		created_by: text("created_by").notNull(),
		updated_at: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
		updated_by: text("updated_by").notNull(),
	},
	(table) => [uniqueIndex("idx_credential_name").on(table.credential_name)],
);
