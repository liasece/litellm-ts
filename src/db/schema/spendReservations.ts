import { sql } from "drizzle-orm";
import { doublePrecision, jsonb, pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * 请求费用预留账本。request_id 是全局幂等键；scope_ids 保存本次独立预算主体。
 */
export const liteLLM_SpendReservations = pgTable(
	"LiteLLM_SpendReservations",
	{
		request_id: text("request_id").notNull().primaryKey(),
		scope_ids: jsonb("scope_ids").$type<readonly string[]>().notNull(),
		reserved: doublePrecision("reserved").notNull(),
		actual: doublePrecision("actual"),
		status: text("status").$type<"reserved" | "released" | "settled">().notNull(),
		expires_at: timestamp("expires_at")
			.notNull()
			.default(sql`now() + interval '15 minutes'`),
		created_at: timestamp("created_at").notNull().defaultNow(),
		updated_at: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("spend_reservations_status_idx").on(table.status),
		index("spend_reservations_scope_ids_gin_idx").using("gin", table.scope_ids),
	],
);
