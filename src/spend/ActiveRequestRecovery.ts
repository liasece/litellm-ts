import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";

export const ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART = "server_restart";

/**
 * 将进程启动前遗留的在途请求转换为可审计的 aborted SpendLog。
 *
 * 单实例服务只在开始监听端口前调用本函数，因此此时全部 in_progress 行都属于旧进程。
 * 插入终态日志、释放预算预留、删除 ActiveRequests 在同一事务中完成；已 checkpoint 的
 * response/usage 会保留（checkpoint 双 key 兼容：普通流式写 streaming_execution、
 * CLIProxy 写 responses_execution，前者优先），未知 usage 与费用保持为 0。proxy_server_request
 * 列随行保留，使 aborted 日志仍能查看原始 request。
 * @param db - Drizzle 数据库实例
 * @param abortedAt - 本次恢复发生的时间
 * @returns 已回收的请求数量
 */
export async function abortOrphanedActiveRequests(db: NodePgDatabase<typeof schema>, abortedAt: Date = new Date()): Promise<number> {
	return db.transaction(async (tx) => {
		const result = await tx.execute(sql`
			WITH orphaned AS MATERIALIZED (
				SELECT *
				FROM "LiteLLM_ActiveRequests"
				WHERE status = 'in_progress'
				FOR UPDATE
			),
			inserted AS (
				INSERT INTO "LiteLLM_SpendLogs" (
					request_id,
					call_type,
					api_key,
					spend,
					total_tokens,
					prompt_tokens,
					completion_tokens,
					"startTime",
					"endTime",
					request_duration_ms,
					"completionStartTime",
					model,
					model_id,
					model_group,
					custom_llm_provider,
					api_base,
					"user",
					metadata,
					cache_hit,
					cache_key,
					request_tags,
					team_id,
					organization_id,
					end_user,
					requester_ip_address,
					messages,
					response,
					session_id,
					status,
					proxy_server_request
				)
				SELECT
					request_id,
					call_type,
					api_key,
					0,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,total_tokens}', metadata #> '{responses_execution,usage,total_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,total_tokens}', metadata #>> '{responses_execution,usage,total_tokens}'))::numeric)::integer
						ELSE 0
					END,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,prompt_tokens}', metadata #> '{responses_execution,usage,prompt_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,prompt_tokens}', metadata #>> '{responses_execution,usage,prompt_tokens}'))::numeric)::integer
						ELSE 0
					END,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,completion_tokens}', metadata #> '{responses_execution,usage,completion_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,completion_tokens}', metadata #>> '{responses_execution,usage,completion_tokens}'))::numeric)::integer
						ELSE 0
					END,
					"startTime",
					${abortedAt},
					-- 不能写"startTime 到本次恢复"的差值：孤儿行可能已存在数天，那会把
					-- 一个几分钟的请求记成 27 小时。恢复时刻不是请求结束时刻，
					-- 真实时长未知，写 0 并保留 startTime/aborted_at 供人工推断。
					0,
					NULL,
					model,
					model_id,
					model_group,
					'',
					'',
					"user",
					COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
						'status', 'aborted',
						'termination_reason', ${ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART}::text,
						'aborted_at', ${abortedAt}::timestamp,
						'error_information', jsonb_build_object(
							'error_type', 'ServerRestartAborted',
							'error_code', 'SERVER_RESTART',
							'error_message', 'Request aborted because the gateway restarted before completion.'
						)
					),
					'',
					'',
					request_tags,
					team_id,
					organization_id,
					end_user,
					requester_ip_address,
					'{}'::jsonb,
					COALESCE(metadata #> '{streaming_execution,response}', metadata #> '{responses_execution,response}', '{}'::jsonb),
					session_id,
					'aborted',
					COALESCE("proxy_server_request", '{}'::jsonb)
				FROM orphaned
				ON CONFLICT (request_id) DO NOTHING
			),
			released AS (
				UPDATE "LiteLLM_SpendReservations"
				SET status = 'released',
					actual = NULL,
					updated_at = ${abortedAt}
				WHERE status = 'reserved'
					AND request_id IN (SELECT request_id FROM orphaned)
			)
			DELETE FROM "LiteLLM_ActiveRequests" AS active
			USING orphaned
			WHERE active.request_id = orphaned.request_id
			RETURNING active.request_id
		`);
		return result.rows.length;
	});
}

/**
 * 回收租约已过期、但进程仍在运行的在途请求（心跳停止的孤儿行）。
 *
 * 与 {@link abortOrphanedActiveRequests} 的区别：启动期恢复会把**全部** in_progress
 * 行视为上个进程的遗留；本函数只在运行期使用 `expires_at` 判定 —— 心跳仍在续租的
 * 真实长流不会被误伤，只有心跳已停（异常退出、遗漏 finalize、连接丢失）的行才会被清理。
 *
 * 若不回收，孤儿行会一直留在 LiteLLM_ActiveRequests 里被反复 UPDATE，直到下一次重启
 * 才被清空；期间"在途请求"面板与并发统计都不准。
 * @param db - Drizzle 数据库实例
 * @param now - 判定基准时刻，缺省取当前时间
 * @returns 已回收的请求数量
 */
export async function reapExpiredActiveRequests(db: NodePgDatabase<typeof schema>, now: Date = new Date()): Promise<number> {
	return db.transaction(async (tx) => {
		const result = await tx.execute(sql`
			WITH expired AS MATERIALIZED (
				SELECT *
				FROM "LiteLLM_ActiveRequests"
				WHERE status = 'in_progress'
					AND expires_at <= ${now}
				FOR UPDATE
			),
			inserted AS (
				INSERT INTO "LiteLLM_SpendLogs" (
					request_id, call_type, api_key, spend, total_tokens,
					prompt_tokens, completion_tokens, "startTime", "endTime",
					request_duration_ms, "completionStartTime", model, model_id,
					model_group, custom_llm_provider, api_base, "user", metadata,
					cache_hit, cache_key, request_tags, team_id, organization_id,
					end_user, requester_ip_address, messages, response, session_id,
					status, proxy_server_request
				)
				SELECT
					request_id, call_type, api_key, 0,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,total_tokens}', metadata #> '{responses_execution,usage,total_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,total_tokens}', metadata #>> '{responses_execution,usage,total_tokens}'))::numeric)::integer
						ELSE 0
					END,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,prompt_tokens}', metadata #> '{responses_execution,usage,prompt_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,prompt_tokens}', metadata #>> '{responses_execution,usage,prompt_tokens}'))::numeric)::integer
						ELSE 0
					END,
					CASE
						WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,completion_tokens}', metadata #> '{responses_execution,usage,completion_tokens}')) = 'number'
						THEN ((COALESCE(metadata #>> '{streaming_execution,usage,completion_tokens}', metadata #>> '{responses_execution,usage,completion_tokens}'))::numeric)::integer
						ELSE 0
					END,
					"startTime",
					${now},
					-- 租约过期说明心跳已停，无法得知真实结束时刻，因此不臆造总时长，
					-- 写入 0 而不是"开始到现在"（后者会把几分钟的请求记成几天）。
					0,
					NULL,
					model, model_id, model_group, '', '', "user",
					COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
						'status', 'aborted',
						'termination_reason', 'lease_expired',
						'aborted_at', ${now}::timestamp,
						'error_information', jsonb_build_object(
							'error_type', 'ActiveRequestLeaseExpired',
							'error_code', 'LEASE_EXPIRED',
							'error_message', 'Request lease expired without a terminal write; reaped by periodic sweep.'
						)
					),
					'', '', request_tags, team_id, organization_id, end_user,
					requester_ip_address, '{}'::jsonb,
					COALESCE(metadata #> '{streaming_execution,response}', metadata #> '{responses_execution,response}', '{}'::jsonb),
					session_id, 'aborted',
					COALESCE("proxy_server_request", '{}'::jsonb)
				FROM expired
				ON CONFLICT (request_id) DO NOTHING
			),
			released AS (
				UPDATE "LiteLLM_SpendReservations"
				SET status = 'released', actual = NULL, updated_at = ${now}
				WHERE status = 'reserved' AND request_id IN (SELECT request_id FROM expired)
			)
			DELETE FROM "LiteLLM_ActiveRequests" AS active
			USING expired
			WHERE active.request_id = expired.request_id
			RETURNING active.request_id
		`);
		return result.rows.length;
	});
}
