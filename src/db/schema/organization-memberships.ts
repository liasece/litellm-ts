/**
 * LiteLLM_OrganizationMembership — user-to-organization membership
 * Prisma model: LiteLLM_OrganizationMembership (composite PK)
 */

import { doublePrecision, pgTable, text, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

export const LiteLLM_OrganizationMembership = pgTable(
	"LiteLLM_OrganizationMembership",
	{
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		userRole: text("user_role"),
		spend: doublePrecision("spend").default(0.0),
		budgetId: text("budget_id"),
		// @map("created_at")
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.organizationId] }),
		uniqueIndex("organization_membership_user_org_key").on(table.userId, table.organizationId),
	],
);
