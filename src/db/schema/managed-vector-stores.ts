/**
 * LiteLLM_ManagedVectorStoreTable — Managed vector store resources (resource-based)
 * Prisma model: LiteLLM_ManagedVectorStoreTable (UUID PK, unique unified_resource_id)
 */

import { pgTable, text, uuid, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_ManagedVectorStoreTable = pgTable(
	"LiteLLM_ManagedVectorStoreTable",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		unifiedResourceId: text("unified_resource_id").notNull(),
		resourceObject: jsonb("resource_object"),
		modelMappings: jsonb("model_mappings").notNull(),
		flatModelResourceIds: text("flat_model_resource_ids").array().default([]),
		storageBackend: text("storage_backend"),
		storageUrl: text("storage_url"),
		createdAt: timestamp("created_at").defaultNow(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at").defaultNow(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("managed_vector_stores_unified_resource_id_key").on(table.unifiedResourceId),
		index("managed_vector_stores_unified_resource_id_idx").on(table.unifiedResourceId),
	],
);
