import { doublePrecision, pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
/**
 * 健康检查表 - LiteLLM_HealthCheckTable
 */
export const LiteLLM_HealthCheckTable = pgTable(
	"LiteLLM_HealthCheckTable",
	{
		health_check_id: uuidText("health_check_id").primaryKey().notNull(),
		model_name: text("model_name").notNull(),
		model_id: text("model_id"),
		status: text("status").notNull(),
		healthy_count: integer("healthy_count").default(0).notNull(),
		unhealthy_count: integer("unhealthy_count").default(0).notNull(),
		error_message: text("error_message"),
		response_time_ms: doublePrecision("response_time_ms"),
		details: jsonb("details"),
		checked_by: text("checked_by"),
		checked_at: timestamp("checked_at", { precision: 3 }).defaultNow().notNull(),
		created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { precision: 3 })
			.$defaultFn(() => new Date())
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("idx_health_check_model_name").on(table.model_name),
		index("idx_health_check_checked_at").on(table.checked_at),
		index("idx_health_check_status").on(table.status),
	],
);
