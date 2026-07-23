import { uuidText } from "./uuidText";
/**
 * LiteLLM_InvitationLink — user invitation links
 * Prisma model: LiteLLM_InvitationLink (uuid PK)
 * NOTE: created_at, expires_at, updated_at have NO default — app must provide.
 */

import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_InvitationLink = pgTable("LiteLLM_InvitationLink", {
	id: uuidText("id").primaryKey().notNull(),
	userId: text("user_id").notNull(),
	isAccepted: boolean("is_accepted").default(false).notNull(),
	acceptedAt: timestamp("accepted_at", { precision: 3 }),
	expiresAt: timestamp("expires_at", { precision: 3 }).notNull(),
	createdAt: timestamp("created_at", { precision: 3 }).notNull(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { precision: 3 }).notNull(),
	updatedBy: text("updated_by").notNull(),
});
