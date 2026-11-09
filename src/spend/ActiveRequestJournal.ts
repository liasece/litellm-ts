/**
 * 在途请求日志补写器。
 *
 * `LiteLLM_ActiveRequests` 里的行在请求结束前是日志详情页的唯一数据源。历史实现只在
 * 注册时写一次快照，导致「进行中」只能看到下游请求；provider / api_base / model_id /
 * 上游请求响应 / 路由解析链 / TTFT 都要等最终 SpendLog 才出现。
 *
 * 这里把「已经确定、后续不会再变、又不是流式临时内容」的字段在确定的那一刻补写进在途行：
 * - 上游交换（provider、api_base、model_id、上游请求与响应）：传输层记录后同步触发；
 * - 首个 chunk 时间：流式端点观测到第一个 chunk 时触发一次。
 *
 * 所有补写都是幂等的小 UPDATE，串行执行且不向请求路径抛错：补写失败只影响这块实时展示，
 * 计费与最终 SpendLog 仍由 `trackSpendLog` 的落账事务独占。仍在变化的内容（聚合中的响应
 * 正文、最终 token 与费用）继续走原有的流式 checkpoint 与最终落账。
 */
import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import type { ModelResolutionTraceCollector } from "../router/ModelResolutionTrace";
import { copyModelResolutionChain, copyRoutingTrace } from "../router/ModelResolutionTrace";
import {
	getRecordedModelResolutionTrace,
	observeUpstreamExchange,
	type UpstreamExchangeObserver,
} from "../router/UpstreamExchange";
import type { UpstreamLogContext } from "../router/UpstreamLogContext";
import {
	buildSpendModelMapInformation,
	sanitizeSpendLogHeaders,
	sanitizeSpendLogPayload,
	sanitizeSpendLogResponsePayload,
	shouldStoreUpstreamLogsInSpendLogs,
} from "./SpendTracker";
import { publishSpendLogChange } from "./spendLogChangeFeed";

const logger = createModuleLogger("ActiveRequestJournal");

/**
 * 请求级在途日志补写器。
 */
export interface ActiveRequestJournal {
	/**
	 * 注册为当前请求作用域的上游交换观察者。
	 * @returns 不在请求作用域内时返回 false（后台任务、单元测试）
	 */
	observeUpstream(): boolean;
	/**
	 * 记录首个响应 chunk 的时间；重复调用只保留第一次。
	 * @param at - 观测时间，默认当前时间
	 */
	markCompletionStart(at?: Date): void;
	/**
	 * 等待已排队的补写落库，用于测试与优雅关闭。
	 */
	flush(): Promise<void>;
}

/**
 * 构建写进在途行 metadata 的路由信息，形状与最终 SpendLog 的 metadata 一致。
 * @param trace - 当前路由解析轨迹
 * @returns 尚未产生任何路由信息时为空对象
 */
export function buildActiveRequestRoutingPatch(trace: ModelResolutionTraceCollector | undefined): Record<string, unknown> {
	if (trace === undefined) {
		return {};
	}
	const patch: Record<string, unknown> = {};
	const modelResolutionChain = copyModelResolutionChain(trace);
	if (modelResolutionChain !== undefined) {
		patch["model_resolution_chain"] = modelResolutionChain;
	}
	const routingTrace = copyRoutingTrace(trace);
	if (routingTrace !== undefined) {
		patch["routing_trace"] = routingTrace;
	}
	if (trace.fallbackModels.length > 0) {
		patch["fallback_models"] = [...trace.fallbackModels];
	}
	return patch;
}

/**
 * 构建写进在途行 `proxy_server_request` 的上游片段，脱敏规则与最终 SpendLog 一致。
 * @param context - 传输层记录的上游交换
 */
export function buildActiveRequestUpstreamPatch(context: UpstreamLogContext): Record<string, unknown> {
	const patch: Record<string, unknown> = {
		upstream_request: sanitizeSpendLogPayload({
			...context.request,
			headers: sanitizeSpendLogHeaders(context.request.headers),
		}),
	};
	if (context.response !== undefined) {
		patch["upstream_response"] = sanitizeSpendLogResponsePayload({
			...context.response,
			headers: sanitizeSpendLogHeaders(context.response.headers),
		});
	}
	return patch;
}

/**
 * 上游交换的路由签名：只在真正推进时补写，重试同一部署不重复写库。
 * @param context - 传输层记录的上游交换
 * @param trace - 当前路由解析轨迹
 * @param family - The model family in the transformed request.
 */
function upstreamSignature(
	context: UpstreamLogContext,
	trace: ModelResolutionTraceCollector | undefined,
	family: string | null | undefined,
): string {
	return [
		context.request.url,
		context.spendInfo?.customLlmProvider,
		context.spendInfo?.modelId,
		context.spendInfo?.deploymentModel,
		family,
		context.response?.status_code ?? "",
		trace?.fallbackDepth ?? 0,
		trace?.routingTrace.length ?? 0,
		trace?.entries.length ?? 0,
	].join("\u0000");
}

/**
 * 创建请求级补写器。
 * @param db - Drizzle 数据库实例
 * @param requestId - 在途行的 request_id
 * @param modelGroup - 与在途行一起登记的公开请求名。
 */
export function createActiveRequestJournal(db: DrizzleDb, requestId: string, modelGroup: string): ActiveRequestJournal {
	let queue: Promise<void> = Promise.resolve();
	let lastSignature: string | undefined;
	let completionStartRequested = false;

	const enqueue = (task: () => Promise<void>): void => {
		queue = queue.then(task).catch((error: unknown) => {
			logger.warn("在途日志补写失败", { error: error, requestId: requestId });
		});
	};

	const writeUpstream = async (context: UpstreamLogContext, routingPatch: Record<string, unknown>): Promise<void> => {
		const spendInfo = context.spendInfo;
		const storeUpstreamLogs = await shouldStoreUpstreamLogsInSpendLogs().catch(() => false);
		const upstreamPatch = storeUpstreamLogs ? buildActiveRequestUpstreamPatch(context) : {};
		const values: Record<string, unknown> = { updated_at: new Date() };
		if (spendInfo) {
			values["custom_llm_provider"] = spendInfo.customLlmProvider;
			values["api_base"] = spendInfo.apiBase;
			values["model_id"] = spendInfo.modelId ?? "";
		}
		if (Object.keys(upstreamPatch).length > 0) {
			values["proxy_server_request"] =
				sql`COALESCE(${liteLLM_ActiveRequests.proxy_server_request}, '{}'::jsonb) || ${JSON.stringify(upstreamPatch)}::jsonb`;
		}
		if (Object.keys(routingPatch).length > 0) {
			values["metadata"] =
				sql`COALESCE(${liteLLM_ActiveRequests.metadata}, '{}'::jsonb) || ${JSON.stringify(routingPatch)}::jsonb`;
		}
		if (Object.keys(values).length === 1) {
			return;
		}
		await db
			.update(liteLLM_ActiveRequests)
			.set(values as PgUpdateSetSource<typeof liteLLM_ActiveRequests>)
			.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")));
		publishSpendLogChange();
	};

	const observer: UpstreamExchangeObserver = (context: UpstreamLogContext): void => {
		if (context.spendInfo === undefined && context.response === undefined) {
			// 还没有部署信息、也没有上游响应：等真正发出请求后的那次记录再补写。
			return;
		}
		const trace = getRecordedModelResolutionTrace();
		const info = context.spendInfo;
		const modelMap = info ? buildSpendModelMapInformation(modelGroup, info.modelId, info.deploymentModel, context.request.body) : undefined;
		const signature = upstreamSignature(context, trace, modelMap?.model_map_value?.model_family);
		if (signature === lastSignature) {
			return;
		}
		lastSignature = signature;
		const routingPatch = buildActiveRequestRoutingPatch(trace);
		if (modelMap) {
			routingPatch["model_map_information"] = modelMap;
		}
		enqueue(() => writeUpstream(context, routingPatch));
	};

	return {
		observeUpstream: (): boolean => observeUpstreamExchange(observer),
		markCompletionStart: (at: Date = new Date()): void => {
			if (completionStartRequested) {
				return;
			}
			completionStartRequested = true;
			enqueue(async (): Promise<void> => {
				await db
					.update(liteLLM_ActiveRequests)
					.set({
						completion_start_time: sql`COALESCE(${liteLLM_ActiveRequests.completion_start_time}, ${at})`,
						updated_at: at,
					})
					.where(
						and(
							eq(liteLLM_ActiveRequests.request_id, requestId),
							eq(liteLLM_ActiveRequests.status, "in_progress"),
						),
					);
				publishSpendLogChange();
			});
		},
		flush: (): Promise<void> => queue,
	};
}
