/**
 * LiteLLM_ManagedVectorStoresTable — Direct vector store definitions (natural key PK)
 * Prisma model: LiteLLM_ManagedVectorStoresTable (vector_store_id natural PK)
 */

import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const liteLLM_ManagedVectorStoresTable = pgTable(
	"LiteLLM_ManagedVectorStoresTable",
	{
		vectorStoreId: text("vector_store_id").notNull().primaryKey(),
		customLlmProvider: text("custom_llm_provider").notNull(),
		vectorStoreName: text("vector_store_name"),
		vectorStoreDescription: text("vector_store_description"),
		vectorStoreMetadata: jsonb("vector_store_metadata"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
		litellmCredentialName: text("litellm_credential_name"),
		litellmParams: jsonb("litellm_params"),
		teamId: text("team_id"),
		userId: text("user_id"),
	},
	(table) => [
		index("managed_vector_stores_direct_team_id_idx").on(table.teamId),
		index("managed_vector_stores_direct_user_id_idx").on(table.userId),
	],
);
