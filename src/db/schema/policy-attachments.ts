/**
 * LiteLLM_PolicyAttachmentTable — Policy-to-resource attachments
 * Prisma model: LiteLLM_PolicyAttachmentTable (UUID PK)
 */

import { pgTable, text, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_PolicyAttachmentTable = pgTable("LiteLLM_PolicyAttachmentTable", {
	attachmentId: uuid("attachment_id").defaultRandom().primaryKey(),
	policyName: text("policy_name").notNull(),
	scope: text("scope"),
	teams: text("teams").array().default([]),
	keys: text("keys").array().default([]),
	models: text("models").array().default([]),
	tags: text("tags").array().default([]),
	createdAt: timestamp("created_at").defaultNow(),
	createdBy: text("created_by"),
	updatedAt: timestamp("updated_at").defaultNow(),
	updatedBy: text("updated_by"),
});
