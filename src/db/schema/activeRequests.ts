import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { CallType } from "../../types/spend";

/**
 * 尚未生成最终 SpendLog 的在途请求。
 *
 * 该表只保存 Logs 列表需要的轻量字段；请求结束后由 SpendTracker 在最终落账事务内删除。
 * expires_at + heartbeat 用于隐藏进程崩溃后遗留的孤儿记录。
 */
export const liteLLM_ActiveRequests = pgTable(
	"LiteLLM_ActiveRequests",
	{
		request_id: text("request_id").notNull().primaryKey(),
		call_type: text("call_type").$type<CallType>().notNull(),
		api_key: text("api_key").default("").notNull(),
		startTime: timestamp("startTime", { precision: 3 }).notNull(),
		model: text("model").default("").notNull(),
		model_id: text("model_id").default(""),
		model_group: text("model_group").default(""),
		user: text("user").default(""),
		team_id: text("team_id"),
		organization_id: text("organization_id"),
		end_user: text("end_user"),
		requester_ip_address: text("requester_ip_address"),
		session_id: text("session_id"),
		metadata: jsonb("metadata").default("{}").notNull(),
		request_tags: jsonb("request_tags").default("[]").notNull(),
		status: text("status").$type<"in_progress">().default("in_progress").notNull(),
		request_duration_ms: integer("request_duration_ms"),
		expires_at: timestamp("expires_at").notNull(),
		updated_at: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("active_requests_status_start_idx").on(table.status, table.startTime),
		index("active_requests_team_idx").on(table.team_id),
		index("active_requests_user_idx").on(table.user),
		index("active_requests_api_key_idx").on(table.api_key),
	],
);
