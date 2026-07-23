import { uuidText } from "./uuidText";
/**
 * LiteLLM_ManagedVectorStoreIndexTable — Vector store index definitions
 * Prisma model: LiteLLM_ManagedVectorStoreIndexTable (UUID PK, unique index_name)
 */

import { pgTable, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const liteLLM_ManagedVectorStoreIndexTable = pgTable(
	"LiteLLM_ManagedVectorStoreIndexTable",
	{
		id: uuidText("id").primaryKey().notNull(),
		indexName: text("index_name").notNull(),
		litellmParams: jsonb("litellm_params").notNull(),
		indexInfo: jsonb("index_info"),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [uniqueIndex("managed_vector_store_index_index_name_key").on(table.indexName)],
);
