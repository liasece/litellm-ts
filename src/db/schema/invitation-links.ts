/**
 * LiteLLM_InvitationLink — user invitation links
 * Prisma model: LiteLLM_InvitationLink (uuid PK)
 * NOTE: created_at, expires_at, updated_at have NO default — app must provide.
 */

import { pgTable, text, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_InvitationLink = pgTable("LiteLLM_InvitationLink", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("user_id").notNull(),
	isAccepted: boolean("is_accepted").default(false),
	acceptedAt: timestamp("accepted_at"),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	updatedBy: text("updated_by").notNull(),
});
