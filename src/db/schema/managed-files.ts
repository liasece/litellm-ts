import { uuidText } from "./uuidText";
/**
 * LiteLLM_ManagedFileTable — Managed file resources
 * Prisma model: LiteLLM_ManagedFileTable (UUID PK, unique unified_file_id)
 */

import { pgTable, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_ManagedFileTable = pgTable(
	"LiteLLM_ManagedFileTable",
	{
		id: uuidText("id").primaryKey().notNull(),
		unifiedFileId: text("unified_file_id").notNull(),
		fileObject: jsonb("file_object"),
		modelMappings: jsonb("model_mappings").notNull(),
		flatModelFileIds: text("flat_model_file_ids").array().default([]),
		storageBackend: text("storage_backend"),
		storageUrl: text("storage_url"),
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("managed_files_unified_file_id_key").on(table.unifiedFileId),
		index("managed_files_unified_file_id_idx").on(table.unifiedFileId),
	],
);
