import { uuidText } from "./uuidText";
/**
 * LiteLLM_PolicyAttachmentTable — Policy-to-resource attachments
 * Prisma model: LiteLLM_PolicyAttachmentTable (UUID PK)
 */

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_PolicyAttachmentTable = pgTable("LiteLLM_PolicyAttachmentTable", {
	attachmentId: uuidText("attachment_id").primaryKey().notNull(),
	policyName: text("policy_name").notNull(),
	scope: text("scope"),
	teams: text("teams").array().default([]),
	keys: text("keys").array().default([]),
	models: text("models").array().default([]),
	tags: text("tags").array().default([]),
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	createdBy: text("created_by"),
	updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updatedBy: text("updated_by"),
});
