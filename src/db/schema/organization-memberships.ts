/**
 * LiteLLM_OrganizationMembership — user-to-organization membership
 * Prisma model: LiteLLM_OrganizationMembership (composite PK)
 */

import { pgTable, text, real, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

export const LiteLLM_OrganizationMembership = pgTable(
	"LiteLLM_OrganizationMembership",
	{
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		userRole: text("user_role"),
		spend: real("spend").default(0.0),
		budgetId: text("budget_id"),
		// @map("created_at")
		createdAt: timestamp("created_at").defaultNow(),
		// @map("updated_at")
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.organizationId] }),
		uniqueIndex("organization_membership_user_org_key").on(table.userId, table.organizationId),
	],
);
