/**
 * LiteLLM_SkillsTable — Skill definitions
 * Prisma model: LiteLLM_SkillsTable (UUID PK)
 */

import { pgTable, text, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_SkillsTable = pgTable("LiteLLM_SkillsTable", {
	skillId: uuid("skill_id").defaultRandom().primaryKey(),
	displayTitle: text("display_title"),
	description: text("description"),
	instructions: text("instructions"),
	source: text("source").default("custom"),
	latestVersion: text("latest_version"),
	fileContent: text("file_content"),
	fileName: text("file_name"),
	fileType: text("file_type"),
	metadata: jsonb("metadata").default("{}"),
	createdAt: timestamp("created_at").defaultNow(),
	createdBy: text("created_by"),
	updatedAt: timestamp("updated_at").defaultNow(),
	updatedBy: text("updated_by"),
});
