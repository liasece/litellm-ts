import { pgTable, text, timestamp, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 凭证表 - LiteLLM_CredentialsTable
 */
export const LiteLLM_CredentialsTable = pgTable(
	"LiteLLM_CredentialsTable",
	{
		credential_id: uuid("credential_id").defaultRandom().primaryKey(),
		credential_name: text("credential_name").notNull(),
		credential_values: jsonb("credential_values").notNull(),
		credential_info: jsonb("credential_info"),
		created_at: timestamp("created_at").defaultNow(),
		created_by: text("created_by").notNull(),
		updated_at: timestamp("updated_at").defaultNow(),
		updated_by: text("updated_by").notNull(),
	},
	(table) => [uniqueIndex("idx_credential_name").on(table.credential_name)],
);
