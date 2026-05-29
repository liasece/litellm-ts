/**
 * LiteLLM_JWTKeyMapping — JWT claim to API key mapping
 * Prisma model: LiteLLM_JWTKeyMapping (uuid PK)
 */

import { pgTable, text, uuid, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const LiteLLM_JWTKeyMapping = pgTable(
	"LiteLLM_JWTKeyMapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		jwtClaimName: text("jwt_claim_name").notNull(),
		jwtClaimValue: text("jwt_claim_value").notNull(),
		token: text("token").notNull(),
		description: text("description"),
		isActive: boolean("is_active").default(true),
		createdAt: timestamp("created_at").defaultNow(),
		createdBy: text("created_by"),
		updatedAt: timestamp("updated_at").defaultNow(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("jwt_key_mapping_claim_key").on(table.jwtClaimName, table.jwtClaimValue),
		index("jwt_key_mapping_claim_active_idx").on(table.jwtClaimName, table.jwtClaimValue, table.isActive),
	],
);
