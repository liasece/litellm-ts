import { uuidText } from "./uuidText";
/**
 * LiteLLM_ManagedObjectTable — Managed object resources
 * Prisma model: LiteLLM_ManagedObjectTable (UUID PK, unique unified_object_id, unique model_object_id)
 */

import { pgTable, text, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_ManagedObjectTable = pgTable(
	"LiteLLM_ManagedObjectTable",
	{
		id: uuidText("id").primaryKey().notNull(),
		unifiedObjectId: text("unified_object_id").notNull(),
		modelObjectId: text("model_object_id").notNull(),
		fileObject: jsonb("file_object").notNull(),
		filePurpose: text("file_purpose").notNull(),
		status: text("status"),
		batchProcessed: boolean("batch_processed").default(false).notNull(),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("managed_objects_unified_object_id_key").on(table.unifiedObjectId),
		uniqueIndex("managed_objects_model_object_id_key").on(table.modelObjectId),
		index("managed_objects_unified_object_id_idx").on(table.unifiedObjectId),
		index("managed_objects_model_object_id_idx").on(table.modelObjectId),
	],
);
