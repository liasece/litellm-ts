/**
 * LiteLLM_ActiveRequests 仓库 — 在途请求行的登记、心跳、补写与回收清理。
 *
 * 在途行只存在于「请求已开始、终态 SpendLog 还没写入」的窗口，是日志详情页在该窗口内
 * 的唯一数据源。它按请求增长、随请求结束删除，因此不做缓存；读取面（另一任务的报表
 * 仓储）可以直接查表，本仓库只负责写入与清理。
 *
 * 所有方法都接收调用方传入的数据库/事务句柄：登记需要与块写入同事务，回收需要与
 * SpendLog 插入、预留释放同事务，事务边界属于调用方，本仓库不自行开启或提交。
 *
 * 两条回收语句是跨表 `WITH ... INSERT ... UPDATE ... DELETE`：插入 aborted SpendLog、
 * 释放预留、删除在途行在一次往返内完成。这是恢复路径的原子性来源，必须保持单条语句。
 */

import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import type { CallType } from "../types/spend";
import { singletonFor } from "./internal/registry";

/** 事务句柄；登记与回收由调用方开启事务。 */
export type ActiveRequestTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 可用于读取/写入在途行的句柄：普通连接或事务。 */
export type ActiveRequestExecutor = DrizzleDb | ActiveRequestTransaction;

/** 登记一条在途请求所需的完整事实（SQL 参数按原样传入）。 */
export interface ActiveRequestRegisterInput {
	/** 与最终 SpendLog 共用的请求 ID。 */
	readonly requestId: string;
	/** LiteLLM 调用类型。 */
	readonly callType: CallType;
	/** 已按 master key 策略保护过的 api key 落库值。 */
	readonly apiKey: string;
	/** 客户端请求的逻辑模型名；同时写入 model 与 model_group。 */
	readonly model: string;
	/** 请求开始时间；缺省为登记时刻。 */
	readonly startTime?: Date;
	/** 用户 ID；缺省写空串（与历史行一致）。 */
	readonly userId?: string | null;
	/** 团队 ID。 */
	readonly teamId?: string | null;
	/** 组织 ID。 */
	readonly organizationId?: string | null;
	/** 终端用户 ID。 */
	readonly endUserId?: string | null;
	/** 请求者 IP。 */
	readonly requesterIpAddress?: string | null;
	/** 请求级 session_id。 */
	readonly sessionId: string;
	/** 初始 metadata（归属、session 分组等）。 */
	readonly metadata: Record<string, unknown>;
	/** 已编码的代理请求负载。 */
	readonly proxyServerRequest: Record<string, unknown>;
	/** 租约到期时间。 */
	readonly expiresAt: Date;
	/** 登记时刻。 */
	readonly now: Date;
}

/** 上游交换补写：只包含本次已经确定、后续不再变化的字段。 */
export interface ActiveRequestUpstreamUpdate {
	/** 部署选定后的 provider / api_base / model_id / 实际执行模型。 */
	readonly spendInfo?: {
		/** 自定义 LLM provider。 */
		readonly customLlmProvider: string;
		/** 上游 API base。 */
		readonly apiBase: string;
		/** 部署 ID；缺省写空串。 */
		readonly modelId?: string | null;
		/** 实际执行模型名（含 fallback 归因）。 */
		readonly model: string;
	};
	/** 要合并进 `proxy_server_request` 的上游片段（已编码）。 */
	readonly proxyServerRequestPatch?: Record<string, unknown>;
	/** 要合并进 `metadata` 的路由片段。 */
	readonly metadataPatch?: Record<string, unknown>;
	/** 本次补写时间。 */
	readonly updatedAt: Date;
}

/**
 * 取得与数据库连接绑定的在途请求仓库。
 * @param db - Drizzle 数据库实例
 */
export const activeRequestRepositoryFor = singletonFor((db: DrizzleDb) => new ActiveRequestRepository(db));

/** `LiteLLM_ActiveRequests` 的写入与清理入口。 */
export class ActiveRequestRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 登记一条在途请求。
	 *
	 * 一次往返完成「已结算判存 + 过期行接管 + 登记」：已落账的 request_id 不再登记；
	 * 同 id 的在途行只有租约过期才允许被本次请求接管，未过期说明并发重复；两种冲突都
	 * 返回空行，由调用方统一按重复 request_id 拒绝。过期行不在这里逐个 DELETE，
	 * 运行期巡检（`reapExpiredActiveRequests`）负责清理。
	 * @param executor - 数据库或事务句柄
	 * @param input - 登记事实
	 * @returns 是否成功登记（false 表示重复 request_id 或已落账）
	 */
	async register(executor: ActiveRequestExecutor, input: ActiveRequestRegisterInput): Promise<boolean> {
		const registered = (await executor.execute(sql`
			INSERT INTO "LiteLLM_ActiveRequests" AS active (
				request_id, call_type, api_key, "startTime", model, model_group, "user",
				team_id, organization_id, end_user, requester_ip_address, session_id,
				metadata, request_tags, proxy_server_request, status, expires_at, updated_at
			)
			SELECT
				${input.requestId}, ${input.callType}, ${input.apiKey},
				${(input.startTime ?? input.now).toISOString()}::timestamp, ${input.model}, ${input.model},
				${input.userId ?? ""}, ${input.teamId ?? null}, ${input.organizationId ?? null},
				${input.endUserId ?? null}, ${input.requesterIpAddress ?? null},
				${input.sessionId},
				${JSON.stringify(input.metadata)}::jsonb, '[]'::jsonb,
				${JSON.stringify(input.proxyServerRequest ?? {})}::jsonb,
				'in_progress', ${input.expiresAt.toISOString()}::timestamp, ${input.now.toISOString()}::timestamp
			WHERE NOT EXISTS (SELECT 1 FROM "LiteLLM_SpendLogs" WHERE request_id = ${input.requestId})
			ON CONFLICT (request_id) DO UPDATE SET
				call_type = EXCLUDED.call_type,
				api_key = EXCLUDED.api_key,
				"startTime" = EXCLUDED."startTime",
				model = EXCLUDED.model,
				model_group = EXCLUDED.model_group,
				"user" = EXCLUDED."user",
				team_id = EXCLUDED.team_id,
				organization_id = EXCLUDED.organization_id,
				end_user = EXCLUDED.end_user,
				requester_ip_address = EXCLUDED.requester_ip_address,
				session_id = EXCLUDED.session_id,
				metadata = EXCLUDED.metadata,
				request_tags = EXCLUDED.request_tags,
				proxy_server_request = EXCLUDED.proxy_server_request,
				status = 'in_progress',
				expires_at = EXCLUDED.expires_at,
				updated_at = EXCLUDED.updated_at
			WHERE active.expires_at <= ${input.now.toISOString()}::timestamp
			RETURNING request_id
		`)) as unknown as { rows: Array<{ request_id?: string }> };
		return registered.rows.length > 0;
	}

	/**
	 * 延长仍在执行的在途请求租约。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param expiresAt - 新的到期时间
	 * @param now - 续租时刻
	 * @returns 是否命中仍在执行的行
	 */
	async renewLease(executor: ActiveRequestExecutor, requestId: string, expiresAt: Date, now: Date): Promise<boolean> {
		const rows = await executor
			.update(liteLLM_ActiveRequests)
			.set({ expires_at: expiresAt, updated_at: now })
			.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")))
			.returning({ requestId: liteLLM_ActiveRequests.request_id });
		return rows.length > 0;
	}

	/**
	 * 合并上游交换补写，并顺带把请求耗时推进到当前时刻。
	 *
	 * 只在确实有新内容时写库：调用方已过滤掉没有部署信息、也没有上游响应的观察事件。
	 * `proxy_server_request` 与 `metadata` 用 `jsonb ||` 合并，避免整列覆盖掉注册时写入的
	 * 下游请求与归属信息。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param update - 本次补写内容
	 * @returns 是否发出了 UPDATE
	 */
	async appendUpstreamExchange(
		executor: ActiveRequestExecutor,
		requestId: string,
		update: ActiveRequestUpstreamUpdate,
	): Promise<boolean> {
		const values: Record<string, unknown> = { updated_at: update.updatedAt };
		if (update.spendInfo !== undefined) {
			values["custom_llm_provider"] = update.spendInfo.customLlmProvider;
			values["api_base"] = update.spendInfo.apiBase;
			values["model_id"] = update.spendInfo.modelId ?? "";
			values["model"] = update.spendInfo.model;
		}
		if (update.proxyServerRequestPatch !== undefined && Object.keys(update.proxyServerRequestPatch).length > 0) {
			values["proxy_server_request"] =
				sql`COALESCE(${liteLLM_ActiveRequests.proxy_server_request}, '{}'::jsonb) || ${JSON.stringify(update.proxyServerRequestPatch)}::jsonb`;
		}
		if (update.metadataPatch !== undefined && Object.keys(update.metadataPatch).length > 0) {
			values["metadata"] =
				sql`COALESCE(${liteLLM_ActiveRequests.metadata}, '{}'::jsonb) || ${JSON.stringify(update.metadataPatch)}::jsonb`;
		}
		if (Object.keys(values).length === 1) {
			return false;
		}
		await executor
			.update(liteLLM_ActiveRequests)
			.set(values as PgUpdateSetSource<typeof liteLLM_ActiveRequests>)
			.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")));
		return true;
	}

	/**
	 * 记录首个响应 chunk 的时间；重复调用只保留第一次。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param at - 首帧观测时间
	 */
	async markCompletionStart(executor: ActiveRequestExecutor, requestId: string, at: Date): Promise<void> {
		await executor
			.update(liteLLM_ActiveRequests)
			.set({
				completion_start_time: sql`COALESCE(${liteLLM_ActiveRequests.completion_start_time}, ${at})`,
				updated_at: at,
			})
			.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")));
	}

	/**
	 * 写入流式执行 checkpoint，并推进请求耗时。
	 *
	 * checkpoint 是「已经观测到的请求状态」的临时快照，只在流结束时写一次，用于崩溃恢复
	 * 与「刚结束、还没结算」的窗口；最终账务仍由 SpendLog 事务独占。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param checkpoint - 已清理的 checkpoint 载荷
	 * @param key - metadata 顶层键（`responses_execution` 或 `streaming_execution`）
	 * @param now - 写入时刻
	 * @returns 是否命中仍在执行的行
	 */
	async writeCheckpoint(
		executor: ActiveRequestExecutor,
		requestId: string,
		checkpoint: unknown,
		key: string,
		now: Date,
	): Promise<boolean> {
		const rows = await executor
			.update(liteLLM_ActiveRequests)
			.set({
				metadata: sql`COALESCE(${liteLLM_ActiveRequests.metadata}, '{}'::jsonb) || jsonb_build_object(${sql.raw(`'${key}'`)}::text, ${JSON.stringify(checkpoint)}::jsonb)`,
				request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
				updated_at: now,
			})
			.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")))
			.returning({ requestId: liteLLM_ActiveRequests.request_id });
		return rows.length > 0;
	}

	/**
	 * 删除一条在途行（请求结束、释放预留时调用）。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 */
	async deleteById(executor: ActiveRequestExecutor, requestId: string): Promise<void> {
		await executor.delete(liteLLM_ActiveRequests).where(eq(liteLLM_ActiveRequests.request_id, requestId));
	}

	/**
	 * 删除在途行并返回是否命中。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @returns 是否删除了行
	 */
	async deleteReturning(executor: ActiveRequestExecutor, requestId: string): Promise<boolean> {
		const removed = await executor
			.delete(liteLLM_ActiveRequests)
			.where(eq(liteLLM_ActiveRequests.request_id, requestId))
			.returning({ requestId: liteLLM_ActiveRequests.request_id });
		return removed.length > 0;
	}

	/**
	 * 兼容仅实现旧查询面的轻量测试/适配器；生产 Drizzle 连接始终提供 delete。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 */
	async deleteIfSupported(executor: ActiveRequestExecutor, requestId: string): Promise<void> {
		const deleteMethod = (executor as unknown as { delete?: DrizzleDb["delete"] }).delete;
		if (typeof deleteMethod !== "function") {
			return;
		}
		await deleteMethod.call(executor, liteLLM_ActiveRequests).where(eq(liteLLM_ActiveRequests.request_id, requestId));
	}

	/**
	 * 启动恢复：把上个进程遗留的全部 `in_progress` 行转成 aborted SpendLog。
	 *
	 * 单实例服务只在开始监听前调用，因此此时全部在途行都属于旧进程。插入终态日志、
	 * 释放预留、删除在途行必须是一条语句：任何一步单独失败都会留下「已删除但在途行
	 * 永远不落账」或「预留永久占用」的脏状态。
	 * @param executor - 数据库或事务句柄
	 * @param abortedAt - 本次恢复时刻
	 * @returns 已回收的请求 ID
	 */
	async abortOrphaned(executor: ActiveRequestExecutor, abortedAt: Date): Promise<string[]> {
		const result = await executor.execute(sql`
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
					key_alias,
					error_code,
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
					proxy_server_request,
					cache_read_input_tokens,
					cache_creation_input_tokens,
					resolved_model_group,
					endpoint
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
					custom_llm_provider,
					'',
					"user",
					(COALESCE(metadata, '{}'::jsonb) - 'streaming_execution' - 'responses_execution') || jsonb_build_object(
						'status', 'aborted',
						'termination_reason', 'server_restart',
						'aborted_at', ${abortedAt}::timestamp,
						'error_information', jsonb_build_object(
							'error_type', 'ServerRestartAborted',
							'error_code', 'SERVER_RESTART',
							'error_message', 'Request aborted because the gateway restarted before completion.'
						)
					),
					-- 过滤列与 metadata 同源：别名取行内 metadata，错误码即本次恢复写入的常量。
					metadata ->> 'user_api_key_alias',
					'SERVER_RESTART',
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
					COALESCE("proxy_server_request", '{}'::jsonb),
					COALESCE(
						CASE
							WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,cache_read_input_tokens}', metadata #> '{responses_execution,usage,cache_read_input_tokens}')) = 'number'
								THEN (COALESCE(metadata #>> '{streaming_execution,usage,cache_read_input_tokens}', metadata #>> '{responses_execution,usage,cache_read_input_tokens}'))::numeric::bigint
						END,
						CASE WHEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens')::bigint END,
						CASE WHEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens')::bigint END,
						0
					),
					COALESCE(
						CASE
							WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,cache_creation_input_tokens}', metadata #> '{responses_execution,usage,cache_creation_input_tokens}')) = 'number'
								THEN (COALESCE(metadata #>> '{streaming_execution,usage,cache_creation_input_tokens}', metadata #>> '{responses_execution,usage,cache_creation_input_tokens}'))::numeric::bigint
						END,
						CASE WHEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens')::bigint END,
						CASE WHEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens')::bigint END,
						0
					),
					COALESCE(NULLIF(metadata ->> 'resolved_model_group', ''), NULLIF(model_group, '')),
					COALESCE(split_part("proxy_server_request" ->> 'url', '?', 1), '')
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
		return result.rows.map((row) => (row as { request_id: string }).request_id);
	}

	/**
	 * 运行期巡检：回收租约已过期、但进程仍在运行的在途请求（心跳停止的孤儿行）。
	 *
	 * 与启动恢复的区别：这里只按 `expires_at` 判定，心跳仍在续租的真实长流不会被误伤。
	 * 插入 aborted SpendLog、释放预留、删除在途行同样是一条语句。
	 * @param executor - 数据库或事务句柄
	 * @param now - 判定基准时刻
	 * @returns 已回收的请求 ID
	 */
	async reapExpired(executor: ActiveRequestExecutor, now: Date): Promise<string[]> {
		const result = await executor.execute(sql`
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
					key_alias, error_code,
					cache_hit, cache_key, request_tags, team_id, organization_id,
					end_user, requester_ip_address, messages, response, session_id,
					status, proxy_server_request,
					cache_read_input_tokens, cache_creation_input_tokens,
					resolved_model_group, endpoint
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
					model, model_id, model_group, custom_llm_provider, '', "user",
					(COALESCE(metadata, '{}'::jsonb) - 'streaming_execution' - 'responses_execution') || jsonb_build_object(
						'status', 'aborted',
						'termination_reason', 'lease_expired',
						'aborted_at', ${now}::timestamp,
						'error_information', jsonb_build_object(
							'error_type', 'ActiveRequestLeaseExpired',
							'error_code', 'LEASE_EXPIRED',
							'error_message', 'Request lease expired without a terminal write; reaped by periodic sweep.'
						)
					),
					metadata ->> 'user_api_key_alias',
					'LEASE_EXPIRED',
					'', '', request_tags, team_id, organization_id, end_user,
					requester_ip_address, '{}'::jsonb,
					COALESCE(metadata #> '{streaming_execution,response}', metadata #> '{responses_execution,response}', '{}'::jsonb),
					session_id, 'aborted',
					COALESCE("proxy_server_request", '{}'::jsonb),
					COALESCE(
						CASE
							WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,cache_read_input_tokens}', metadata #> '{responses_execution,usage,cache_read_input_tokens}')) = 'number'
								THEN (COALESCE(metadata #>> '{streaming_execution,usage,cache_read_input_tokens}', metadata #>> '{responses_execution,usage,cache_read_input_tokens}'))::numeric::bigint
						END,
						CASE WHEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens')::bigint END,
						CASE WHEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens')::bigint END,
						0
					),
					COALESCE(
						CASE
							WHEN jsonb_typeof(COALESCE(metadata #> '{streaming_execution,usage,cache_creation_input_tokens}', metadata #> '{responses_execution,usage,cache_creation_input_tokens}')) = 'number'
								THEN (COALESCE(metadata #>> '{streaming_execution,usage,cache_creation_input_tokens}', metadata #>> '{responses_execution,usage,cache_creation_input_tokens}'))::numeric::bigint
						END,
						CASE WHEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens')::bigint END,
						CASE WHEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
							THEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens')::bigint END,
						0
					),
					COALESCE(NULLIF(metadata ->> 'resolved_model_group', ''), NULLIF(model_group, '')),
					COALESCE(split_part("proxy_server_request" ->> 'url', '?', 1), '')
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
		return result.rows.map((row) => (row as { request_id: string }).request_id);
	}
}
