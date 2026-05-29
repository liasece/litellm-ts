/**
 * LiteLLM_ManagedObjectTable — Managed object resources
 * Prisma model: LiteLLM_ManagedObjectTable (UUID PK, unique unified_object_id, unique model_object_id)
 */

import { pgTable, text, uuid, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_ManagedObjectTable = pgTable(
	"LiteLLM_ManagedObjectTable",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		unifiedObjectId: text("unified_object_id").notNull(),
		modelObjectId: text("model_object_id").notNull(),
		fileObject: jsonb("file_object").notNull(),
		filePurpose: text("file_purpose").notNull(),
		status: text("status"),
		batchProcessed: boolean("batch_processed").default(false),
		createdAt: timestamp("created_at").defaultNow(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at").defaultNow(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("managed_objects_unified_object_id_key").on(table.unifiedObjectId),
		uniqueIndex("managed_objects_model_object_id_key").on(table.modelObjectId),
		index("managed_objects_unified_object_id_idx").on(table.unifiedObjectId),
		index("managed_objects_model_object_id_idx").on(table.modelObjectId),
	],
);
