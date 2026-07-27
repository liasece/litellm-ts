import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";

export const ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART = "server_restart";

/**
 * 将进程启动前遗留的在途请求转换为可审计的 aborted SpendLog。
 *
 * 单实例服务只在开始监听端口前调用本函数，因此此时全部 in_progress 行都属于旧进程。
 * 插入终态日志、释放预算预留、删除 ActiveRequests 在同一事务中完成；未知 usage 与费用保持为 0。
 * @param db - Drizzle 数据库实例
 * @param abortedAt - 本次恢复发生的时间
 * @returns 已回收的请求数量
 */
export async function abortOrphanedActiveRequests(
	db: NodePgDatabase<typeof schema>,
	abortedAt: Date = new Date(),
): Promise<number> {
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
					0,
					0,
					0,
					"startTime",
					${abortedAt},
					GREATEST(
						0,
						FLOOR(EXTRACT(EPOCH FROM (${abortedAt}::timestamp - "startTime")) * 1000)
					)::integer,
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
					'{}'::jsonb,
					session_id,
					'aborted',
					'{}'::jsonb
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
