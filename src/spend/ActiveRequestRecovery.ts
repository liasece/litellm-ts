import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogBlocks } from "../db/schema/spendLogBlocks";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { createModuleLogger } from "../core/utils/logger";
import {
	SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE,
	type SpendLogBlockRecord,
	collectReferencedBlockIds,
	collectSpendLogBlocks,
	selectMissingSpendLogBlocks,
	shouldDeduplicateSpendLogBlocks,
} from "./SpendLogBlocks";
import { publishSpendLogChange } from "./spendLogChangeFeed";

const logger = createModuleLogger("Spend:ActiveRequestRecovery");

/** 回收事务句柄，用于在同一个事务里补做内容寻址编码。 */
type RecoveryTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export const ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART = "server_restart";
/** 租约过期回收写入的终止原因（见 reapExpiredActiveRequests）。 */
export const ACTIVE_REQUEST_ABORT_REASON_LEASE_EXPIRED = "lease_expired";

/**
 * 把刚回收的 SpendLog 行换成内容寻址引用。
 *
 * 两条回收 SQL 都是 `INSERT ... SELECT`，直接把 `proxy_server_request` 原样搬进
 * SpendLogs，因此绕过了正常写入路径的块编码 —— 一次重启就能留下几行 1 MB 以上的
 * 完整请求体。这里在同一个事务里补做编码，规则与 {@link collectSpendLogBlocks}
 * 完全一致。
 *
 * 只处理本次刚插入的行（按 termination_reason 精确定位），已编码的行跳过；任何异常
 * 只记录日志 —— 行里保留原始请求体依然可读，去重是存储优化，不应影响启动恢复。
 * @param tx - 回收事务
 * @param requestIds - 本次回收的 request_id
 * @param terminationReason - 本次回收写入的 metadata.termination_reason
 */
async function encodeRecoveredRequestPayloads(
	tx: RecoveryTransaction,
	requestIds: readonly string[],
	terminationReason: string,
): Promise<void> {
	if (requestIds.length === 0) {
		return;
	}
	try {
		if (!(await shouldDeduplicateSpendLogBlocks())) {
			return;
		}
		const rows = await tx
			.select({ requestId: liteLLM_SpendLogs.request_id, proxyServerRequest: liteLLM_SpendLogs.proxy_server_request })
			.from(liteLLM_SpendLogs)
			.where(
				and(
					inArray(liteLLM_SpendLogs.request_id, [...requestIds]),
					sql`${liteLLM_SpendLogs.metadata}->>'termination_reason' = ${terminationReason}`,
				),
			);
		const blocks = new Map<string, SpendLogBlockRecord>();
		const updates: Array<{ requestId: string; proxyServerRequest: unknown }> = [];
		for (const row of rows) {
			// 已经带引用键的行跳过：再编码一次会把引用当成字面量剥掉，反而丢掉内容。
			if (collectReferencedBlockIds({}, row.proxyServerRequest).length > 0) {
				continue;
			}
			const encoding = collectSpendLogBlocks({ messages: {}, proxyServerRequest: row.proxyServerRequest });
			if (encoding.blocks.length === 0) {
				continue;
			}
			for (const block of encoding.blocks) {
				blocks.set(block.blockId, block);
			}
			updates.push({ requestId: row.requestId, proxyServerRequest: encoding.proxyServerRequest });
		}
		if (updates.length === 0) {
			return;
		}
		const blockList = [...blocks.values()];
		// 回收行里的历史正文在正常写入路径上大多已经存在，先判存，只补写缺失的块。
		const blocksToInsert = await selectMissingSpendLogBlocks(tx, blockList);
		for (let offset = 0; offset < blocksToInsert.length; offset += SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE) {
			await tx
				.insert(liteLLM_SpendLogBlocks)
				.values(blocksToInsert.slice(offset, offset + SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE).map((block) => ({ ...block })))
				.onConflictDoNothing();
		}
		for (const update of updates) {
			await tx
				.update(liteLLM_SpendLogs)
				.set({ proxy_server_request: update.proxyServerRequest })
				.where(eq(liteLLM_SpendLogs.request_id, update.requestId));
		}
		logger.info("回收行已按内容寻址去重", { recovered: updates.length, blocks: blocksToInsert.length });
	} catch (error) {
		logger.warn("回收行内容寻址去重失败，保留原始请求体", { error: error, requests: requestIds.length });
	}
}

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
	const recovered = await db.transaction(async (tx) => {
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
		const requestIds = result.rows.map((row) => (row as { request_id: string }).request_id);
		await encodeRecoveredRequestPayloads(tx, requestIds, ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART);
		return requestIds.length;
	});
	if (recovered > 0) {
		publishSpendLogChange();
	}
	return recovered;
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
	const recovered = await db.transaction(async (tx) => {
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
		const requestIds = result.rows.map((row) => (row as { request_id: string }).request_id);
		await encodeRecoveredRequestPayloads(tx, requestIds, ACTIVE_REQUEST_ABORT_REASON_LEASE_EXPIRED);
		return requestIds.length;
	});
	if (recovered > 0) {
		publishSpendLogChange();
	}
	return recovered;
}
