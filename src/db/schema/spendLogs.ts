import { doublePrecision, pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CallType, SpendLogStatus } from "../../types/spend";

export const liteLLM_SpendLogs = pgTable(
	"LiteLLM_SpendLogs",
	{
		request_id: text("request_id").notNull().primaryKey(),
		call_type: text("call_type").$type<CallType>().notNull(),
		api_key: text("api_key").default("").notNull(),
		spend: doublePrecision("spend").default(0.0).notNull(),
		total_tokens: integer("total_tokens").default(0).notNull(),
		prompt_tokens: integer("prompt_tokens").default(0).notNull(),
		completion_tokens: integer("completion_tokens").default(0).notNull(),
		startTime: timestamp("startTime", { precision: 3 }).notNull(),
		endTime: timestamp("endTime", { precision: 3 }).notNull(),
		request_duration_ms: integer("request_duration_ms"),
		completionStartTime: timestamp("completionStartTime", { precision: 3 }),
		model: text("model").default("").notNull(),
		model_id: text("model_id").default(""),
		model_group: text("model_group").default(""),
		custom_llm_provider: text("custom_llm_provider").default(""),
		api_base: text("api_base").default(""),
		user: text("user").default(""),
		metadata: jsonb("metadata").default("{}"),
		/**
		 * 过滤用冗余列，取值与 metadata 中的同名字段一致（`user_api_key_alias` /
		 * `error_information.error_code`）。metadata 平均 3 KB 且存放在 TOAST，
		 * 直接用它做表头过滤要为窗口内每一行解压整份 JSON（冷缓存下 24h 窗口 9–40 s）；
		 * 这两列让过滤只读小列，写入时由服务端填好，历史行由
		 * `scripts/backfill-spend-log-filter-columns.cjs` 回填。
		 */
		key_alias: text("key_alias"),
		error_code: text("error_code"),
		cache_hit: text("cache_hit").default(""),
		cache_key: text("cache_key").default(""),
		request_tags: jsonb("request_tags").default("[]"),
		team_id: text("team_id"),
		organization_id: text("organization_id"),
		end_user: text("end_user"),
		requester_ip_address: text("requester_ip_address"),
		messages: jsonb("messages").default("{}"),
		response: jsonb("response").default("{}"),
		session_id: text("session_id"),
		session_group_key: text("session_group_key").generatedAlwaysAs(
			() => sql`litellm_session_group_key(metadata, session_id, request_id)`,
		),
		status: text("status").$type<SpendLogStatus>(),
		mcp_namespaced_tool_name: text("mcp_namespaced_tool_name"),
		agent_id: text("agent_id"),
		proxy_server_request: jsonb("proxy_server_request").default("{}"),
	},
	(table) => ({
		startTimeIdx: index("idx_spend_logs_start_time").on(table.startTime),
		startTimeRequestIdIdx: index("idx_spend_logs_start_time_request_id").on(table.startTime, table.request_id),
		endUserIdx: index("idx_spend_logs_end_user").on(table.end_user),
		sessionIdIdx: index("idx_spend_logs_session_id").on(table.session_id),
		sessionGroupTimeIdx: index("idx_spend_logs_session_group_time").on(table.session_group_key, table.startTime, table.request_id),
		// Error Code 过滤是等值匹配，索引能把「窗口内逐行解压 metadata」换成精确查找。
		// key_alias 过滤保持 Python 的 LIKE '%x%' 语义，btree 用不上，因此不为它建索引。
		errorCodeTimeIdx: index("idx_spend_logs_error_code_time").on(table.error_code, table.startTime),
	}),
);
