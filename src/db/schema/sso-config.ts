/**
 * LiteLLM_SSOConfig — SSO configuration (single-row table, PK = "sso_config")
 * Prisma model: LiteLLM_SSOConfig
 */

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const LiteLLM_SSOConfig = pgTable("LiteLLM_SSOConfig", {
	id: text("id").default("sso_config").primaryKey().notNull(),
	ssoSettings: jsonb("sso_settings").notNull(),
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3 })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull(),
});
