import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { CallType } from "../../types/spend";

/**
 * 尚未生成最终 SpendLog 的在途请求。
 *
 * 行内容随请求推进逐步补齐，而不是只保存注册那一刻的快照：
 * - 注册时写入下游请求与认证上下文；
 * - 部署选定、上游请求发出时补齐 custom_llm_provider / api_base / model_id 与上游交换；
 * - 流式首个 chunk 到达时补齐 completion_start_time；
 * - 只能结束时才知道的最终字段（spend、最终 token、错误信息、endTime）仍由最终 SpendLog 承载。
 *
 * 请求结束后由 SpendTracker 在最终落账事务内删除；expires_at + heartbeat 提供存活性信息；
 * 进程启动时会将遗留行转为 aborted SpendLog。
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
		custom_llm_provider: text("custom_llm_provider").default("").notNull(),
		api_base: text("api_base").default("").notNull(),
		user: text("user").default(""),
		team_id: text("team_id"),
		organization_id: text("organization_id"),
		end_user: text("end_user"),
		requester_ip_address: text("requester_ip_address"),
		session_id: text("session_id"),
		metadata: jsonb("metadata").default("{}").notNull(),
		request_tags: jsonb("request_tags").default("[]").notNull(),
		proxy_server_request: jsonb("proxy_server_request").default("{}").notNull(),
		status: text("status").$type<"in_progress">().default("in_progress").notNull(),
		request_duration_ms: integer("request_duration_ms"),
		completion_start_time: timestamp("completion_start_time", { precision: 3 }),
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
