/**
 * LiteLLM_DeprecatedVerificationToken — Deprecated (rotated) tokens
 * Prisma model: LiteLLM_DeprecatedVerificationToken (UUID PK, unique token)
 */

import { pgTable, text, uuid, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const liteLLM_DeprecatedVerificationToken = pgTable(
	"LiteLLM_DeprecatedVerificationToken",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		token: text("token").notNull(),
		activeTokenId: text("active_token_id").notNull(),
		revokeAt: timestamp("revoke_at").notNull(),
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		uniqueIndex("deprecated_verification_tokens_token_key").on(table.token),
		index("deprecated_verification_tokens_token_revoke_at_idx").on(table.token, table.revokeAt),
		index("deprecated_verification_tokens_revoke_at_idx").on(table.revokeAt),
	],
);
