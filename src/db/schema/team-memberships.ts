/**
 * LiteLLM_TeamMembership — user-to-team membership
 * Prisma model: LiteLLM_TeamMembership (composite PK)
 */

import { pgTable, text, real, primaryKey } from "drizzle-orm/pg-core";

export const LiteLLM_TeamMembership = pgTable(
	"LiteLLM_TeamMembership",
	{
		userId: text("user_id").notNull(),
		teamId: text("team_id").notNull(),
		spend: real("spend").default(0.0),
		budgetId: text("budget_id"),
	},
	(table) => [primaryKey({ columns: [table.userId, table.teamId] })],
);
