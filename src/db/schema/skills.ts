import { uuidText } from "./uuidText";
/**
 * LiteLLM_SkillsTable — Skill definitions
 * Prisma model: LiteLLM_SkillsTable (UUID PK)
 */

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_SkillsTable = pgTable("LiteLLM_SkillsTable", {
	skillId: uuidText("skill_id").primaryKey().notNull(),
	displayTitle: text("display_title"),
	description: text("description"),
	instructions: text("instructions"),
	source: text("source").default("custom").notNull(),
	latestVersion: text("latest_version"),
	fileContent: text("file_content"),
	fileName: text("file_name"),
	fileType: text("file_type"),
	metadata: jsonb("metadata").default("{}"),
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	createdBy: text("created_by"),
	updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	updatedBy: text("updated_by"),
});
