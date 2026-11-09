/**
 * Logs 详情页的数据面。
 *
 * 同一个"详情负载"被两个入口共用：HTTP 的 `/spend/logs/ui/:request_id` 与 WebSocket
 * 订阅 `/spend/logs/ui/stream`。把查询与合并逻辑集中在这里，流式推送的每一帧与一次性
 * 拉取的结果保持同一形状，前端只需按顶层字段合并。
 */

import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { createModuleLogger } from "../core/utils/logger";
import { getRequestResponsePayloadFromColdStorage } from "./SpendLogColdStorage";
import { hydrateSpendLogRow } from "./SpendLogBlocks";
import { toFiniteNumber } from "./spendManagementFormatters";

const logger = createModuleLogger("Spend:UiLogDetail");

/** 详情负载：SpendLogs 行、冷存储 payload 或在途行投影。 */
export type UiLogDetailPayload = Record<string, unknown>;

/**
 * 读取进行中 checkpoint 里已经观测到的 token 用量。
 *
 * 普通流式写归一化的 prompt/completion/total；CLIProxy 的 responses_execution 直接存
 * provider 原始 usage（input/output_tokens），两种命名都要认。
 * @param checkpoint - 在途行里的执行 checkpoint
 */
export function readInProgressUsage(
	checkpoint: Record<string, unknown> | undefined,
): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined {
	const usage = checkpoint?.["usage"];
	if (typeof usage !== "object" || usage === null) {
		return undefined;
	}
	const record = usage as Record<string, unknown>;
	const promptTokens = toFiniteNumber(record["prompt_tokens"] ?? record["input_tokens"]);
	const completionTokens = toFiniteNumber(record["completion_tokens"] ?? record["output_tokens"]);
	const totalTokens = toFiniteNumber(record["total_tokens"], promptTokens + completionTokens);
	if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
		return undefined;
	}
	return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
}

/**
 * 在途行的轻量修订号：日志流据此判断"这次轮询是否有新东西"，避免每次重读整份负载。
 *
 * `updated_at` 由 checkpoint 补写、心跳续租与一次性字段补写共同推进，任何真实变化都会让它前进。
 * @param db - 数据库实例
 * @param requestId - 请求 ID
 */
export async function readActiveRequestRevision(
	db: NodePgDatabase<typeof schema>,
	requestId: string,
): Promise<{ present: boolean; updatedAt: string | null; status: string | null }> {
	const rows = await db
		.select({
			status: liteLLM_ActiveRequests.status,
			updated_at: liteLLM_ActiveRequests.updated_at,
		})
		.from(liteLLM_ActiveRequests)
		.where(eq(liteLLM_ActiveRequests.request_id, requestId))
		.limit(1);
	const row = rows.at(0);
	if (!row) {
		return { present: false, updatedAt: null, status: null };
	}
	return {
		present: true,
		updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
		status: row.status,
	};
}

/**
 * 进行中请求的详情投影。
 *
 * 返回在途行里已经补写确定的字段（provider/api_base/model_id/上游交换/TTFT/已观测
 * token），使详情页不必等最终 SpendLog 才显示路由与用量。
 * @param db - 数据库实例
 * @param requestId - 请求 ID
 */
export async function buildActiveRequestDetail(
	db: NodePgDatabase<typeof schema>,
	requestId: string,
): Promise<UiLogDetailPayload | null> {
	const activeRows = await db
		.select({
			request_id: liteLLM_ActiveRequests.request_id,
			call_type: liteLLM_ActiveRequests.call_type,
			startTime: liteLLM_ActiveRequests.startTime,
			model: liteLLM_ActiveRequests.model,
			model_id: liteLLM_ActiveRequests.model_id,
			model_group: liteLLM_ActiveRequests.model_group,
			custom_llm_provider: liteLLM_ActiveRequests.custom_llm_provider,
			api_base: liteLLM_ActiveRequests.api_base,
			user: liteLLM_ActiveRequests.user,
			team_id: liteLLM_ActiveRequests.team_id,
			organization_id: liteLLM_ActiveRequests.organization_id,
			end_user: liteLLM_ActiveRequests.end_user,
			requester_ip_address: liteLLM_ActiveRequests.requester_ip_address,
			session_id: liteLLM_ActiveRequests.session_id,
			request_tags: liteLLM_ActiveRequests.request_tags,
			completion_start_time: liteLLM_ActiveRequests.completion_start_time,
			proxy_server_request: liteLLM_ActiveRequests.proxy_server_request,
			metadata: liteLLM_ActiveRequests.metadata,
			request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
		})
		.from(liteLLM_ActiveRequests)
		.where(eq(liteLLM_ActiveRequests.request_id, requestId))
		.limit(1);
	const activeRow = activeRows.at(0);
	if (!activeRow) {
		return null;
	}
	const metadata = (activeRow.metadata ?? {}) as Record<string, unknown>;
	// checkpoint 双 key 兼容——普通流式写 streaming_execution，CLIProxy 写 responses_execution，前者优先。
	const checkpoint =
		(metadata["streaming_execution"] as Record<string, unknown> | undefined) ??
		(metadata["responses_execution"] as Record<string, unknown> | undefined);
	// 进行中请求的 proxy_server_request 含传输层补写的 upstream 信息；早期 checkpoint 里
	// 记录的 upstream 字段作为兜底，保证升级前写入的行也能看到上游视图。
	const upstreamRequest = checkpoint?.["upstream_request"] as Record<string, unknown> | undefined;
	const upstreamResponse = checkpoint?.["upstream_response"] as Record<string, unknown> | undefined;
	const proxyServerRequest = {
		...(activeRow.proxy_server_request ?? {}),
		...(upstreamRequest ? { upstream_request: upstreamRequest } : {}),
		...(upstreamResponse ? { upstream_response: upstreamResponse } : {}),
	};
	// checkpoint 是内部执行细节，已经从 response/usage 单独暴露，不再混进 metadata。
	const settledMetadata: Record<string, unknown> = { ...metadata };
	delete settledMetadata["streaming_execution"];
	delete settledMetadata["responses_execution"];
	const usage = readInProgressUsage(checkpoint);
	// TTFT 来自首个 chunk 补写；升级前的行只有 CLIProxy checkpoint 里的 first_chunk_at。
	const checkpointFirstChunk =
		typeof checkpoint?.["first_chunk_at"] === "string" ? new Date(checkpoint["first_chunk_at"] as string) : null;
	const completionStartTime = activeRow.completion_start_time ?? checkpointFirstChunk;
	return {
		messages: undefined,
		response: (checkpoint?.["response"] as Record<string, unknown> | undefined) ?? null,
		proxy_server_request: proxyServerRequest,
		status: "in_progress",
		request_id: activeRow.request_id,
		call_type: activeRow.call_type,
		startTime: activeRow.startTime.toISOString(),
		endTime: new Date().toISOString(),
		completionStartTime:
			completionStartTime instanceof Date && !Number.isNaN(completionStartTime.getTime())
				? completionStartTime.toISOString()
				: null,
		model: activeRow.model,
		model_id: activeRow.model_id,
		model_group: activeRow.model_group,
		custom_llm_provider: activeRow.custom_llm_provider,
		api_base: activeRow.api_base,
		user: activeRow.user,
		team_id: activeRow.team_id,
		organization_id: activeRow.organization_id,
		end_user: activeRow.end_user,
		requester_ip_address: activeRow.requester_ip_address,
		session_id: activeRow.session_id,
		request_tags: activeRow.request_tags,
		request_duration_ms: activeRow.request_duration_ms,
		prompt_tokens: usage?.prompt_tokens ?? 0,
		completion_tokens: usage?.completion_tokens ?? 0,
		total_tokens: usage?.total_tokens ?? 0,
		usage: checkpoint?.["usage"] ?? null,
		metadata: settledMetadata,
	};
}

/**
 * `/spend/logs/ui/:request_id` 与日志流最终帧共用的详情负载。
 *
 * 对齐 PY ui_view_request_response_for_request_id（spend_management_endpoints.py:2028-2048）：
 * 先遍历冷存储 CustomLogger（S3/GCS 等），任一返回非 null payload 即采用；
 * 无注册实现或全部未命中时回落 DB 重列，最后才看是否仍在执行。
 * @param db - 数据库实例
 * @param requestId - 请求 ID
 * @param startDate - 可选起始时间（收窄冷存储回查窗口）
 * @param endDate - 可选结束时间
 */
export async function buildUiSpendLogDetail(
	db: NodePgDatabase<typeof schema>,
	requestId: string,
	startDate?: Date,
	endDate?: Date,
): Promise<UiLogDetailPayload | null> {
	const coldStoragePayload = await getRequestResponsePayloadFromColdStorage(
		requestId,
		startDate,
		endDate,
		(_coldStorageLogger, error) => logger.warn(`/spend/logs/ui/:request_id 冷存储回查失败: ${(error as Error).message}`),
	);
	if (coldStoragePayload !== null) {
		// 冷存储里的负载与落库同源，可能也是引用形态；同样按块组装。
		return await hydrateSpendLogRow(db, coldStoragePayload);
	}

	const rows = await db
		.select({
			messages: liteLLM_SpendLogs.messages,
			response: liteLLM_SpendLogs.response,
			proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
		})
		.from(liteLLM_SpendLogs)
		.where(eq(liteLLM_SpendLogs.request_id, requestId))
		.limit(1);

	const completed = rows.at(0);
	if (completed) {
		// 内容寻址去重后，messages / proxy_server_request 里存的是块引用；
		// 详情与日志流共用这一处组装，保证两种编码对外形状一致。
		return await hydrateSpendLogRow(db, completed);
	}

	return await buildActiveRequestDetail(db, requestId);
}
