import { pgTable, text, timestamp, integer, real, jsonb, uuid, index } from "drizzle-orm/pg-core";

/**
 * 健康检查表 - LiteLLM_HealthCheckTable
 */
export const LiteLLM_HealthCheckTable = pgTable(
	"LiteLLM_HealthCheckTable",
	{
		health_check_id: uuid("health_check_id").defaultRandom().primaryKey(),
		model_name: text("model_name").notNull(),
		model_id: text("model_id"),
		status: text("status").notNull(),
		healthy_count: integer("healthy_count").default(0),
		unhealthy_count: integer("unhealthy_count").default(0),
		error_message: text("error_message"),
		response_time_ms: real("response_time_ms"),
		details: jsonb("details"),
		checked_by: text("checked_by"),
		checked_at: timestamp("checked_at").defaultNow(),
		created_at: timestamp("created_at").defaultNow(),
		updated_at: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		index("idx_health_check_model_name").on(table.model_name),
		index("idx_health_check_checked_at").on(table.checked_at),
		index("idx_health_check_status").on(table.status),
	],
);
