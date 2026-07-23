/**
 * Anthropic Messages API 原生端点
 *
 * 提供符合 Anthropic Messages API 规格的代理端点：
 * - POST /v1/messages — 转发消息到 Anthropic 兼容 provider，支持流式 SSE 透传
 * - POST /v1/messages/count_tokens — Token 计数（桩实现）
 *
 * 自定义补丁集成：
 * - Patch 1: UTF-16 代理对清理
 * - Patch 2: Qwen3 reasoning_text 事件处理
 * - Patch 3: Claude Code user_id 标准化
 * - Patch 6+15: message_start 去重
 * - Patch 7: websearch_override_target_model
 * - Patch 8: 访问日志过滤器（src/middleware/AccessLogFilter.ts）— 非 2xx 响应日志
 * - Patch 9: _ensureBlockForItem + tool_use 空名 guard
 * - Patch 10: count_tokens 转发到上游（替代本地估算）
 * - Patch 11: 流式先经 fallback 链建立连接（_openAnthropicStream + AnthropicUpstreamDispatch）
 * - Patch 12: SSE keep-alive ping
 * - Patch 13: Files API 转发（文件上传/列表/下载/删除）
 * - Patch 14: model_group_alias 解析回退（src/router/FallbackHandler.ts）
 * - Patch 16: Batches API 转发（批量消息创建/列表/查询/取消）
 * - Patch 17: body.model 替换（deployment.litellm_params.model 剥离 provider 前缀）+
 *   Router fallback 链重试 + 失败冷却（src/proxy/AnthropicUpstreamDispatch.ts）+
 *   响应 model 改写回原请求 model（非流式 responseData.model / 流式合成 message_start）
 */
import type { Router, Request, Response } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { createModuleLogger } from "../core/utils/logger";
import { cleanSurrogates } from "../core/utils/text";
import { getConfig } from "../core/config";
import { buildSpendLogFromRequest, calculateAndSetCost, releaseSpend, trackSpendLog } from "../spend/SpendTracker";
import { createEndpointSpendLifecycle, reserveEndpointSpend } from "../spend/SpendReservation";
import { runCommonChecks } from "../auth/AuthChecks";
import { CallType, SpendLogStatus } from "../types/spend";
import type { DrizzleDb } from "../core/db/Database";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { ModelResponse } from "../types/openai";
import { ProviderUpstreamError, executeWithFallbackChain, requireUpstreamAttempt, type UpstreamAttempt } from "./AnthropicUpstreamDispatch";
import { buildDeploymentSpendInfo, type DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { executeProviderRequest } from "../router/ProviderRequestExecutor";
import {
	buildAnthropicSearchContinuation,
	mergeAgenticLoopUsage,
	executeWebSearchCalls,
	extractAnthropicWebSearchCalls,
	resolveGooglePseSearchConfig,
} from "../websearch/WebSearchInterceptor";

const logger = createModuleLogger("AnthropicMsg");

/** keep-alive ping 间隔（ms） */
const KEEPALIVE_INTERVAL_MS = 2_000;

// ========== Patch 1: UTF-16 代理对清理 ==========

function sanitizeRequestBody(body: unknown): unknown {
	if (body === null || body === undefined) {
		return body;
	}
	if (typeof body === "string") {
		return cleanSurrogates(body);
	}
	if (Array.isArray(body)) {
		return body.map(sanitizeRequestBody);
	}
	if (typeof body === "object") {
		const obj = body as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(obj)) {
			result[key] = sanitizeRequestBody(obj[key]);
		}
		return result;
	}
	return body;
}

// ========== Patch 3: user_id 标准化 ==========

function normalizeUserId(userId: string): string {
	if (userId.startsWith("user|")) {
		return userId.slice(5);
	}
	return userId;
}

// ========== Patch 6+15: message_start 去重 ==========

/**
 * 保守检测一个 chunk 是否"纯粹"的 message_start 事件。
 * 处理 bytes/str、单帧判定、JSON 解码、type==="message_start" 验证。
 * @param chunk
 */
function _isPureMessageStartChunk(chunk: unknown): boolean {
	if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
		return false;
	}
	const chunkStr = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
	const frames = chunkStr
		.split("\n\n")
		.filter((f) => f.trim().length > 0)
		.map((f) => f.trim());
	if (frames.length !== 1) {
		return false;
	}
	const dataLines: string[] = [];
	for (const line of frames[0]!.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("data:")) {
			dataLines.push(trimmed.slice(5).trimStart());
		}
	}
	if (dataLines.length === 0) {
		return false;
	}
	try {
		const payload = JSON.parse(dataLines.join("\n"));
		return typeof payload === "object" && payload !== null && payload["type"] === "message_start";
	} catch {
		return false;
	}
}

// ========== Patch 7: websearch_override_target_model ==========

/**
 * @param t
 */
function _isWebSearchTool(t: unknown): boolean {
	const tool = t as Record<string, unknown> | undefined;
	if (!tool) {
		return false;
	}
	if (
		tool["type"] === "web_search" ||
		tool["type"] === "web_search_20250305" ||
		(typeof tool["type"] === "string" && (tool["type"] as string).startsWith("web_search_"))
	) {
		return true;
	}
	if (tool["name"] === "web_search" || tool["name"] === "litellm_web_search") {
		return true;
	}
	if (tool["type"] === "function") {
		const fn = tool["function"] as Record<string, unknown> | undefined;
		if (fn && (fn["name"] === "web_search" || fn["name"] === "litellm_web_search")) {
			return true;
		}
	}
	return false;
}

/**
 * @param data
 * @param generalSettings
 */
function _applyWebSearchOverrideTargetModel(data: Record<string, unknown>, generalSettings: Record<string, unknown>): void {
	const targetModel = generalSettings["websearch_override_target_model"];
	if (!targetModel || typeof targetModel !== "string") {
		return;
	}
	const tools = data["tools"];
	if (!Array.isArray(tools) || tools.length === 0) {
		return;
	}
	const allWebSearch = tools.every((t) => _isWebSearchTool(t));
	if (!allWebSearch) {
		return;
	}
	const toolChoice = data["tool_choice"];
	if (typeof toolChoice !== "object" || toolChoice === null) {
		return;
	}
	const tc = toolChoice as Record<string, unknown>;
	if (tc["type"] !== "tool" || tc["name"] !== "web_search") {
		return;
	}
	data["model"] = targetModel;
}

// ========== Patch 9: _ensureBlockForItem + tool_use 空名 guard ==========

interface ChunkQueueItem {
	type: string;
	index: number;
	content_block?: Record<string, unknown>;
	delta?: Record<string, unknown>;
}

/**
 * @param chunkQueue
 * @param itemIdToBlockIndex
 * @param currentBlockIndex
 * @param itemId
 * @param blockType
 */
function _ensureBlockForItem(
	chunkQueue: ChunkQueueItem[],
	itemIdToBlockIndex: Map<string, number>,
	currentBlockIndex: { value: number },
	itemId: string | undefined,
	blockType: "text" | "thinking" | "tool_use",
): number {
	if (itemId && itemIdToBlockIndex.has(itemId)) {
		return itemIdToBlockIndex.get(itemId)!;
	}
	// tool_use: 故意跳过 content_block_start 合成（name 不可用，空名会触发 Claude Code 拒绝）
	if (blockType === "tool_use") {
		const idx = currentBlockIndex.value;
		if (itemId) {
			itemIdToBlockIndex.set(itemId, idx);
		}
		return idx;
	}
	// text/thinking: 合成 content_block_start
	const idx = currentBlockIndex.value++;
	if (itemId) {
		itemIdToBlockIndex.set(itemId, idx);
	}
	const contentBlock: Record<string, unknown> =
		blockType === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" };
	chunkQueue.push({ type: "content_block_start", index: idx, content_block: contentBlock });
	return idx;
}

interface NativeStreamAccumulator {
	id?: string;
	type?: string;
	role?: string;
	model?: string;
	content: Map<number, Record<string, unknown>>;
	toolInputJson: Map<number, string>;
	stopReason?: unknown;
	stopSequence?: unknown;
	usage: Record<string, number>;
}

function setNumberField(target: Record<string, number>, source: Record<string, unknown>, field: string): void {
	if (typeof source[field] === "number") {
		target[field] = source[field];
	}
}

function parseSsePayload(chunk: string): Record<string, unknown> | undefined {
	const data = chunk
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => line.slice(6))
		.join("\n");
	if (!data) {
		return undefined;
	}
	try {
		const payload: unknown = JSON.parse(data);
		return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function accumulateNativeStreamEvent(state: NativeStreamAccumulator, payload: Record<string, unknown>): void {
	const type = payload["type"];
	if (type === "message_start") {
		const message = payload["message"] as Record<string, unknown> | undefined;
		if (!message) {
			return;
		}
		for (const field of ["id", "type", "role", "model"] as const) {
			if (typeof message[field] === "string") {
				if (field === "id") {
					state.id ??= message.id as string;
				} else {
					state[field] = message[field];
				}
			}
		}
		const usage = message["usage"] as Record<string, unknown> | undefined;
		if (usage) {
			for (const field of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
				setNumberField(state.usage, usage, field);
			}
		}
		return;
	}
	if (type === "content_block_start" && typeof payload["index"] === "number") {
		const block = payload["content_block"];
		if (typeof block === "object" && block !== null) {
			state.content.set(payload["index"], { ...(block as Record<string, unknown>) });
		}
		return;
	}
	if (type === "content_block_delta" && typeof payload["index"] === "number") {
		const index = payload["index"];
		const delta = payload["delta"] as Record<string, unknown> | undefined;
		const block = state.content.get(index);
		if (!delta || !block) {
			return;
		}
		if (delta["type"] === "text_delta" && typeof delta["text"] === "string") {
			block["text"] = `${String(block["text"] ?? "")}${delta["text"]}`;
		} else if (delta["type"] === "thinking_delta" && typeof delta["thinking"] === "string") {
			block["thinking"] = `${String(block["thinking"] ?? "")}${delta["thinking"]}`;
		} else if (delta["type"] === "signature_delta" && typeof delta["signature"] === "string") {
			block["signature"] = `${String(block["signature"] ?? "")}${delta["signature"]}`;
		} else if (delta["type"] === "input_json_delta" && typeof delta["partial_json"] === "string") {
			state.toolInputJson.set(index, `${state.toolInputJson.get(index) ?? ""}${delta["partial_json"]}`);
		}
		return;
	}
	if (type === "content_block_stop" && typeof payload["index"] === "number") {
		const index = payload["index"];
		const partialJson = state.toolInputJson.get(index);
		const block = state.content.get(index);
		if (partialJson !== undefined && block) {
			try {
				block["input"] = JSON.parse(partialJson);
			} catch {
				block["input"] = partialJson;
			}
		}
		return;
	}
	if (type === "message_delta") {
		const delta = payload["delta"] as Record<string, unknown> | undefined;
		if (delta) {
			state.stopReason = delta["stop_reason"];
			state.stopSequence = delta["stop_sequence"];
		}
		const usage = payload["usage"] as Record<string, unknown> | undefined;
		if (usage) {
			for (const field of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
				setNumberField(state.usage, usage, field);
			}
		}
	}
}

function buildNativeStreamResponse(state: NativeStreamAccumulator, requestedModel: string): Record<string, unknown> | undefined {
	if (!state.id && state.content.size === 0) {
		return undefined;
	}
	return {
		id: state.id ?? "",
		type: state.type ?? "message",
		role: state.role ?? "assistant",
		model: requestedModel,
		content: [...state.content.entries()].sort(([left], [right]) => left - right).map(([, block]) => block),
		stop_reason: state.stopReason,
		stop_sequence: state.stopSequence,
		usage: state.usage,
	};
}
// ========== SSE 格式化 ==========

function formatSSE(event: string, data: string): string {
	return `event: ${event}\ndata: ${data}\n\n`;
}

function sendPing(res: Response): void {
	res.write(formatSSE("ping", "{}"));
}

// ========== Patch 11: deferred responses stream ==========

/**
 * 从已建立连接的上游 Response 读取 SSE 流的 async generator。
 * 调用方需先通过 _openAnthropicStream 完成连接与状态检查。
 * @param result - 上游 fetch Response（已确认 2xx）
 * @yields {string}
 */
async function* _streamAnthropicSse(result: globalThis.Response): AsyncGenerator<string> {
	const reader = result.body?.getReader();
	if (!reader) {
		return;
	}

	const decoder = new TextDecoder();
	let buffer = "";
	const itemIdToBlockIndex = new Map<string, number>();
	const currentBlockIndex = { value: 0 };

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}

				// 解析 SSE 事件
				if (trimmed.startsWith("event: ")) {
					const eventType = trimmed.slice(7);
					// Patch 2: Qwen3 reasoning_text
					if (eventType === "response.reasoning_text.delta" || eventType === "reasoning_summary_text.delta") {
						// 后续 data 行会处理
					}
					continue;
				}

				if (!trimmed.startsWith("data: ")) {
					continue;
				}

				try {
					const payload = JSON.parse(trimmed.slice(6));

					// Patch 2: Qwen3 reasoning_text
					if (payload.type === "response.reasoning_text.delta") {
						const itemId = payload.item_id as string | undefined;
						const pendingStarts: Array<{ type: string; index: number; content_block?: Record<string, unknown> }> = [];
						const blockIdx = _ensureBlockForItem(pendingStarts, itemIdToBlockIndex, currentBlockIndex, itemId, "thinking");
						// Yield any newly synthesized content_block_start so the client
						// knows about the block before receiving deltas for it.
						for (const start of pendingStarts) {
							yield formatSSE("content_block_start", JSON.stringify(start));
						}
						yield formatSSE(
							"content_block_delta",
							JSON.stringify({
								type: "content_block_delta",
								index: blockIdx,
								delta: { type: "thinking_delta", thinking: String(payload.delta ?? "") },
							}),
						);
						continue;
					}

					// Patch 9: content_block_delta 关联 item_id
					if (payload.type === "content_block_delta") {
						const itemId = payload.item_id as string | undefined;
						if (itemId && itemIdToBlockIndex.has(itemId)) {
							payload.index = itemIdToBlockIndex.get(itemId);
						}
					}

					if (payload.type === "content_block_start" && payload.content_block?.type === "tool_use") {
						// Patch 9: tool_use content_block_start — 检查空名
						if (!payload.content_block.name) {
							payload.content_block.name = "__unnamed__";
						}
					}

					// 重新序列化 — 保持 payload.type 作为 SSE event name
					const eventType = typeof payload.type === "string" ? payload.type : "message";
					yield formatSSE(eventType, JSON.stringify(payload));
					if (eventType === "message_stop") {
						return;
					}
				} catch (error) {
					throw new Error("Provider 返回 malformed SSE event", { cause: error });
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * 建立上游流式连接：fetch 并检查状态码，成功返回 SSE generator。
 * 连接失败 / 非 2xx 抛 ProviderUpstreamError（供 fallback 链重试下一 deployment）。
 * @param attempt - 当前上游 deployment 与请求信息
 * @param body - 转发请求体（model 已替换为上游 model 名）
 * @param signal - 客户端取消信号
 */
async function _openAnthropicStream(
	attempt: UpstreamAttempt,
	body: Record<string, unknown>,
	signal: AbortSignal,
): Promise<AsyncGenerator<string>> {
	const timeoutSec = attempt.deployment.litellm_params.stream_timeout ?? attempt.deployment.litellm_params.timeout;
	const execution = await executeProviderRequest(
		{
			url: attempt.upstreamUrl,
			method: "POST",
			headers: { ...attempt.upstreamHeaders, "Content-Type": "application/json" },
			body: body,
			model: attempt.upstreamModel,
			stream: true,
		},
		{
			readJson: false,
			signal: signal,
			timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
		},
	);
	const result = execution.response;

	if (!result.ok) {
		const errBody = await result.text().catch(() => "");
		throw new ProviderUpstreamError(result.status, `Provider 返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
	}

	return _streamAnthropicSse(result);
}

// ========== 端点注册 ==========

/**
 * @param router
 * @param litellmRouter
 * @param _requireAuth
 * @param db
 */
export function registerAnthropicMessagesEndpoints(
	router: Router,
	litellmRouter: LiteLLMRouter,
	_requireAuth?: (req: Request, res: Response, next: () => void) => void,
	db?: DrizzleDb,
): void {
	logger.info("注册 Anthropic Messages API 端点");

	// POST /v1/messages
	registerRoute(router, { method: "post", path: "/v1/messages" }, async (req, res) => {
		if (res.headersSent) {
			return;
		}

		// PY litellm_overhead_time_ms 基准：请求进入代理的时间
		const requestArrivalTimeMs = Date.now();

		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		if (!cleanBody) {
			throw ApiError.badRequest("请求体为空");
		}

		const requestedModel = cleanBody.model as string | undefined;
		if (!requestedModel) {
			throw ApiError.badRequest("缺少 model 字段");
		}

		// GAP 7: Anthropic Messages 端点也需要走授权检查（blocked/expires/budget/
		// soft_budget/parallel/team model access），对齐 PY `user_api_key_auth()` 统一入口
		// （user_api_key_auth.py:1354 `_virtual_key_soft_budget_check`）。
		// ChatCompletions 端点已调用 runCommonChecks；此前 Anthropic 端点绕过整套检查。
		// 授权检查用原请求 model（PY：auth 依赖注入先于 websearch override 执行）。
		if (req.auth) {
			runCommonChecks(req.auth, requestedModel);
		}

		// Patch 7: websearch override
		const generalSettings = getConfig().generalSettings as unknown as Record<string, unknown>;
		_applyWebSearchOverrideTargetModel(cleanBody, generalSettings);

		// Patch 3: user_id 标准化
		if (typeof cleanBody.metadata === "object" && cleanBody.metadata !== null) {
			const meta = cleanBody.metadata as Record<string, unknown>;
			if (typeof meta.user_id === "string") {
				meta.user_id = normalizeUserId(meta.user_id);
			}
		}

		// 路由 model：websearch override 之后（对齐 PY common_request_processing 顺序：
		// override 改写 data["model"] 后才调 router）。spend / 响应 model 改写仍用 requestedModel。
		const model = cleanBody.model as string;
		const stream = cleanBody.stream === true;
		const requestApiKey = cleanBody["api_key"] as string | undefined;
		const requestAnthropicVersion = cleanBody["anthropic_version"] as string | undefined;
		const auth = req.auth;
		const webSearchAbortController = new AbortController();
		const abortWebSearch = (): void => webSearchAbortController.abort();
		req.once("aborted", abortWebSearch);
		res.once("close", abortWebSearch);
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, req, model, cleanBody);
		const spendRequestId = spendReservation?.requestId;
		const spendLifecycle = createEndpointSpendLifecycle(spendReservation);

		try {
			spendLifecycle.markProviderStarted();
			if (stream) {
				const streamStartTime = new Date();
				const streamAccumulator: NativeStreamAccumulator = { content: new Map(), toolInputJson: new Map(), usage: {} };
				let streamError: unknown;
				let completionStartTime: Date | undefined;
				// 批次 9: 记录实际成功的上游 attempt（spend 归因用）
				let executedAttempt: UpstreamAttempt | undefined;
				// metadata.attempted_retries 数据源：fallback 链跳数回写
				const streamFallbackStats = { fallbackDepth: 0, fallbackModels: [] as string[] };
				// PY litellm_overhead_time_ms：请求进入→上游发起前的代理层开销
				const streamOverheadTimeMs = Date.now() - requestArrivalTimeMs;

				// 先经 fallback 链建立上游连接：失败时响应头未发送，
				// 由 registerRoute 返回标准 HTTP 错误（对齐 PY 全部 deployment 失败时的行为）；
				// body.model 逐次替换为当前 deployment 剥离 provider 前缀后的上游 model 名。
				let anthropicStream: AsyncGenerator<string>;
				try {
					anthropicStream = await executeWithFallbackChain(
						litellmRouter,
						model,
						requestApiKey,
						requestAnthropicVersion,
						(attempt) => {
							const opened = _openAnthropicStream(
								attempt,
								{
									...cleanBody,
									model: attempt.upstreamModel,
								},
								webSearchAbortController.signal,
							);
							executedAttempt = attempt;
							return opened;
						},
						streamFallbackStats,
					);
				} catch (error) {
					if (db && auth && spendRequestId) {
						try {
							await spendLifecycle.finalize(() =>
								trackSpendLog(
									db,
									buildSpendLogFromRequest({
										req: req,
										auth: auth,
										requestId: spendRequestId,
										callType: CallType.AMessages,
										model: requestedModel,
										modelGroup: requestedModel,
										startTime: streamStartTime,
										endTime: new Date(),
										messages: cleanBody.messages,
										error: error,
										status: SpendLogStatus.Failure,
									}),
								).then(() => undefined),
							);
						} catch (accountingError) {
							logger.error("Anthropic 上游连接失败后的花费账务提交失败", {
								accountingError: accountingError,
								requestId: spendRequestId,
							});
							try {
								await releaseSpend(db, spendRequestId);
							} catch (releaseError) {
								logger.error("Anthropic 上游连接失败后释放 reservation 失败", {
									error: releaseError,
									requestId: spendRequestId,
								});
							}
						}
					}
					throw error;
				}

				// Patch 12: SSE keep-alive
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const pingTimer = setInterval(() => {
					try {
						sendPing(res);
					} catch {
						clearInterval(pingTimer);
					}
				}, KEEPALIVE_INTERVAL_MS);

				req.on("close", () => clearInterval(pingTimer));

				try {
					// Patch 6+15: 合成 message_start → 跳过上游首次纯 message_start
					// （合成事件用原请求 model，上游透传的 message_start 被跳过，不泄露上游 model 名）
					const syntheticMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
					streamAccumulator.id = syntheticMsgId;
					res.write(
						formatSSE(
							"message_start",
							JSON.stringify({
								type: "message_start",
								message: {
									id: syntheticMsgId,
									type: "message",
									role: "assistant",
									model: requestedModel,
									content: [],
									usage: { input_tokens: 0, output_tokens: 0 },
								},
							}),
						),
					);

					let firstChunk = true;
					for await (const sseChunk of anthropicStream) {
						const payload = parseSsePayload(sseChunk);
						if (payload) {
							accumulateNativeStreamEvent(streamAccumulator, payload);
						}
						if (firstChunk && _isPureMessageStartChunk(sseChunk)) {
							firstChunk = false;
							continue;
						}
						firstChunk = false;
						completionStartTime ??= new Date();
						res.write(sseChunk);
					}
				} catch (err) {
					streamError = err;
					res.write(formatSSE("error", JSON.stringify({ type: "error", error: { type: "api_error", message: String(err) } })));
					logger.error("流式响应错误", { error: String(err) });
				} finally {
					clearInterval(pingTimer);
					res.end();

					// 即使无 usage 也提交零费用失败/成功日志，确保 reservation 不会遗留。
					if (db && auth && spendRequestId) {
						const streamEndTime = new Date();
						const response = buildNativeStreamResponse(streamAccumulator, requestedModel);
						// 批次 9: 实际执行 deployment 的 spend 归因（provider/api_base/model_id/model_info 价格）
						const spendInfo: DeploymentSpendInfo | undefined = executedAttempt
							? buildDeploymentSpendInfo(executedAttempt.deployment, executedAttempt.upstreamUrl)
							: undefined;
						const spendLog = buildSpendLogFromRequest({
							req: req,
							auth: auth,
							requestId: spendRequestId,
							callType: CallType.AMessages,
							model: requestedModel,
							// PY: model_group=原请求逻辑模型名（fallback 时仍为原请求名）
							modelGroup: requestedModel,
							modelId: spendInfo?.modelId,
							customLlmProvider: spendInfo?.customLlmProvider,
							apiBase: spendInfo?.apiBase,
							customCostPerToken: spendInfo?.customCostPerToken,
							deploymentModel: spendInfo?.deploymentModel,
							litellmOverheadTimeMs: streamOverheadTimeMs,
							attemptedRetries: streamFallbackStats.fallbackDepth,
							maxRetries: litellmRouter.maxFallbacks,
							fallbackModels: streamFallbackStats.fallbackModels,
							startTime: streamStartTime,
							endTime: streamEndTime,
							completionStartTime: completionStartTime,
							messages: cleanBody.messages,
							response: response,
							usage: streamAccumulator.usage,
							error: streamError,
							status: streamError === undefined ? SpendLogStatus.Success : SpendLogStatus.Failure,
						});
						try {
							await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
						} catch (accountingError) {
							// SSE headers 已发送，无法改写为 503；记录错误供账务补偿处理。
							logger.error("Anthropic 流式花费账务提交失败", {
								error: accountingError,
								requestId: spendRequestId,
							});
							if (streamError !== undefined) {
								await releaseSpend(db, spendRequestId).catch((releaseError: unknown) => {
									logger.error("Anthropic 流式 Provider 失败后释放 reservation 失败", {
										error: releaseError,
										requestId: spendRequestId,
									});
								});
							}
						}
					}
				}
				return;
			}

			// PY: record startTime at request start for non-streaming
			const nonStreamingStartTime = new Date();
			// 批次 9: 记录实际成功的上游 attempt（spend 归因用）
			let executedNsAttempt: UpstreamAttempt | undefined;
			// PY 非流式 completionStartTime：上游响应返回（body 解析完成）的时间点，
			// TTFT = completionStartTime - startTime（含输入处理与排队时长）
			let nsCompletionStartTime: Date | undefined;
			// 非流式响应 — 经 fallback 链直连上游；body.model 逐次替换为上游 model 名
			// metadata.attempted_retries 数据源：fallback 链跳数回写
			const nsFallbackStats = { fallbackDepth: 0, fallbackModels: [] as string[] };
			// PY litellm_overhead_time_ms：请求进入→上游发起前的代理层开销
			const nsOverheadTimeMs = Date.now() - requestArrivalTimeMs;
			let responseData: Record<string, unknown>;
			let initialNsResponse: Record<string, unknown> | undefined;
			let usageCalculated = false;
			try {
				responseData = await executeWithFallbackChain(
					litellmRouter,
					model,
					requestApiKey,
					requestAnthropicVersion,
					async (attempt) => {
						const timeoutSec = attempt.deployment.litellm_params.timeout;
						const execution = await executeProviderRequest(
							{
								url: attempt.upstreamUrl,
								method: "POST",
								headers: { ...attempt.upstreamHeaders, "Content-Type": "application/json" },
								body: { ...cleanBody, model: attempt.upstreamModel },
								model: attempt.upstreamModel,
							},
							{
								readJson: false,
								signal: webSearchAbortController.signal,
								timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
							},
						);
						const result = execution.response;

						if (!result.ok) {
							const errBody = await result.text().catch(() => "");
							throw new ProviderUpstreamError(
								result.status,
								`Provider 返回错误 (${result.status}): ${errBody.slice(0, 200)}`,
							);
						}

						nsCompletionStartTime = new Date();
						const responseJson = (await result.json()) as Record<string, unknown>;
						executedNsAttempt = attempt;
						return responseJson;
					},
					nsFallbackStats,
				);
				initialNsResponse = responseData;

				const requestTools = Array.isArray(cleanBody["tools"]) ? cleanBody["tools"] : [];
				const searchCalls = extractAnthropicWebSearchCalls(responseData, requestTools);
				if (searchCalls.length > 0) {
					const initialSpendInfo = executedNsAttempt
						? buildDeploymentSpendInfo(executedNsAttempt.deployment, executedNsAttempt.upstreamUrl)
						: undefined;
					calculateAndSetCost(responseData as unknown as ModelResponse, requestedModel, initialSpendInfo?.customCostPerToken);
					const searchConfig = resolveGooglePseSearchConfig(getConfig(), initialSpendInfo?.customLlmProvider);
					if (searchConfig) {
						const searchResults = await executeWebSearchCalls(searchCalls, searchConfig, webSearchAbortController.signal);
						const continuation = buildAnthropicSearchContinuation(responseData, searchCalls, searchResults);
						const originalMessages = Array.isArray(cleanBody["messages"]) ? cleanBody["messages"] : [];
						const followUpStats = { fallbackDepth: 0, fallbackModels: [] as string[] };
						responseData = await executeWithFallbackChain(
							litellmRouter,
							model,
							requestApiKey,
							requestAnthropicVersion,
							async (attempt) => {
								const timeoutSec = attempt.deployment.litellm_params.timeout;
								const execution = await executeProviderRequest(
									{
										url: attempt.upstreamUrl,
										method: "POST",
										headers: { ...attempt.upstreamHeaders, "Content-Type": "application/json" },
										body: {
											...cleanBody,
											model: attempt.upstreamModel,
											messages: [...originalMessages, ...continuation],
										},
										model: attempt.upstreamModel,
									},
									{
										readJson: false,
										signal: webSearchAbortController.signal,
										timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
									},
								);
								const result = execution.response;
								if (!result.ok) {
									throw new ProviderUpstreamError(result.status, `Provider 返回错误 (${result.status})`);
								}
								nsCompletionStartTime = new Date();
								executedNsAttempt = attempt;
								return (await result.json()) as Record<string, unknown>;
							},
							followUpStats,
						);
						nsFallbackStats.fallbackDepth += followUpStats.fallbackDepth;
						nsFallbackStats.fallbackModels.push(...followUpStats.fallbackModels);
						const finalSpendInfo = executedNsAttempt
							? buildDeploymentSpendInfo(executedNsAttempt.deployment, executedNsAttempt.upstreamUrl)
							: undefined;
						calculateAndSetCost(responseData as unknown as ModelResponse, requestedModel, finalSpendInfo?.customCostPerToken);
						mergeAgenticLoopUsage(responseData, initialNsResponse, searchCalls.length);
						usageCalculated = true;
					}
				}
			} catch (error) {
				if (db && auth && spendRequestId) {
					try {
						await spendLifecycle.finalize(() =>
							trackSpendLog(
								db,
								buildSpendLogFromRequest({
									req: req,
									auth: auth,
									requestId: spendRequestId,
									callType: CallType.AMessages,
									model: requestedModel,
									modelGroup: requestedModel,
									startTime: nonStreamingStartTime,
									endTime: new Date(),
									messages: cleanBody.messages,
									response: initialNsResponse,
									usage: initialNsResponse?.["usage"] as Record<string, unknown> | undefined,
									error: error,
									status: SpendLogStatus.Failure,
								}),
							).then(() => undefined),
						);
					} catch (accountingError) {
						logger.error("Anthropic Provider 失败后的花费账务提交失败", {
							accountingError: accountingError,
							requestId: spendRequestId,
						});
						try {
							await releaseSpend(db, spendRequestId);
						} catch (releaseError) {
							logger.error("Anthropic Provider 失败后释放 reservation 失败", {
								error: releaseError,
								requestId: spendRequestId,
							});
						}
					}
				}
				throw error;
			}
			const nonStreamingEndTime = new Date();
			// 批次 9: 实际执行 deployment 的 spend 归因（provider/api_base/model_id/model_info 价格）
			const nsSpendInfo: DeploymentSpendInfo | undefined = executedNsAttempt
				? buildDeploymentSpendInfo(executedNsAttempt.deployment, executedNsAttempt.upstreamUrl)
				: undefined;
			// 响应 model 改写回原请求 model（Python 实测：fallback 后响应 model 仍为客户端请求 model）
			responseData["model"] = requestedModel;
			if (!usageCalculated) {
				calculateAndSetCost(responseData as unknown as ModelResponse, requestedModel, nsSpendInfo?.customCostPerToken);
			}

			// PY: inject x-litellm-response-cost header (PY logging middleware)
			const nsUsage = responseData["usage"] as Record<string, unknown> | undefined;
			if (nsUsage && nsUsage["cost"] !== undefined) {
				res.setHeader("x-litellm-response-cost", String(nsUsage["cost"]));
			}

			// 非流式 spend 追踪（model 记原请求 model，对齐 Python SpendLogs 行为）
			if (db && auth && spendRequestId) {
				const usage = responseData["usage"] as Record<string, unknown> | undefined;
				const spendLog = buildSpendLogFromRequest({
					req: req,
					auth: auth,
					requestId: spendRequestId,
					callType: CallType.AMessages,
					model: requestedModel,
					// PY: model_group=原请求逻辑模型名（fallback 时仍为原请求名）
					modelGroup: requestedModel,
					modelId: nsSpendInfo?.modelId,
					customLlmProvider: nsSpendInfo?.customLlmProvider,
					apiBase: nsSpendInfo?.apiBase,
					customCostPerToken: nsSpendInfo?.customCostPerToken,
					deploymentModel: nsSpendInfo?.deploymentModel,
					litellmOverheadTimeMs: nsOverheadTimeMs,
					attemptedRetries: nsFallbackStats.fallbackDepth,
					fallbackModels: nsFallbackStats.fallbackModels,
					maxRetries: litellmRouter.maxFallbacks,
					startTime: nonStreamingStartTime,
					endTime: nonStreamingEndTime,
					completionStartTime: nsCompletionStartTime,
					messages: cleanBody.messages,
					response: responseData,
					usage: usage,
					status: SpendLogStatus.Success,
				});
				await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
			}

			return responseData;
		} finally {
			req.removeListener("aborted", abortWebSearch);
			res.removeListener("close", abortWebSearch);
			spendLifecycle.stop();
		}
	});

	// POST /v1/messages/count_tokens — Patch 10: 转发到上游
	registerRoute(router, { method: "post", path: "/v1/messages/count_tokens" }, async (req) => {
		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		const model = cleanBody.model as string | undefined;
		if (!model) {
			throw ApiError.badRequest("缺少 model 字段");
		}
		// GAP 7: 同步在 count_tokens 端点走授权检查，对齐 PY `_virtual_key_soft_budget_check`
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}
		const attempt = requireUpstreamAttempt(
			litellmRouter,
			model,
			cleanBody["api_key"] as string | undefined,
			cleanBody["anthropic_version"] as string | undefined,
		);
		const countUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/count_tokens");
		const result = await fetch(countUrl, {
			method: "POST",
			headers: {
				...attempt.upstreamHeaders,
				"Content-Type": "application/json",
				"anthropic-beta": "token-counting-2024-11-01",
			},
			// body.model 替换为剥离 provider 前缀后的上游 model 名
			body: JSON.stringify({ ...cleanBody, model: attempt.upstreamModel }),
		});
		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `CountTokens 返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}
		return await result.json();
	});

	// ========== Patch 13: Files API 转发 ==========

	registerRoute(router, { method: "post", path: "/v1/files" }, async (req) => {
		const body = sanitizeRequestBody(req.body) as Record<string, unknown>;
		const model = (body.model as string) ?? "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const filesUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, "/v1/files");
		const result = await fetch(filesUrl, {
			method: "POST",
			headers: { ...attempt.upstreamHeaders, "Content-Type": "application/json" },
			// body.model 替换为剥离 provider 前缀后的上游 model 名
			body: JSON.stringify({ ...body, model: attempt.upstreamModel }),
		});
		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `Files 上传返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const filesUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, "/v1/files");
		const result = await fetch(filesUrl, { headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 列表返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files/:id" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const fileUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}`);
		const result = await fetch(fileUrl, { headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 查询返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files/:id/content" }, async (req, res) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const contentUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}/content`);
		const result = await fetch(contentUrl, { headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 内容返回错误 (${result.status})`);
		}
		const blob = await result.blob();
		res.setHeader("Content-Type", result.headers.get("content-type") ?? "application/octet-stream");
		res.setHeader("Content-Disposition", result.headers.get("content-disposition") ?? "attachment");
		res.send(Buffer.from(await blob.arrayBuffer()));
	});

	registerRoute(router, { method: "delete", path: "/v1/files/:id" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const fileUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}`);
		const result = await fetch(fileUrl, { method: "DELETE", headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 删除返回错误 (${result.status})`);
		}
		return await result.json();
	});

	// ========== Patch 16: Batches API 转发 ==========

	registerRoute(router, { method: "post", path: "/v1/messages/batches" }, async (req) => {
		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		const model = (cleanBody.model as string) ?? "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const batchesUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/batches");
		const result = await fetch(batchesUrl, {
			method: "POST",
			headers: { ...attempt.upstreamHeaders, "Content-Type": "application/json" },
			// body.model 替换为剥离 provider 前缀后的上游 model 名
			body: JSON.stringify({ ...cleanBody, model: attempt.upstreamModel }),
		});
		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `Batches 创建返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/messages/batches" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const batchesUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/batches");
		const result = await fetch(batchesUrl, { headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 列表返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/messages/batches/:id" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const batchUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, `/v1/messages/batches/${req.params["id"]}`);
		const result = await fetch(batchUrl, { headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 查询返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "post", path: "/v1/messages/batches/:id/cancel" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const attempt = requireUpstreamAttempt(litellmRouter, model);
		const cancelUrl = attempt.upstreamUrl.replace(/\/v1\/messages$/, `/v1/messages/batches/${req.params["id"]}/cancel`);
		const result = await fetch(cancelUrl, { method: "POST", headers: attempt.upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 取消返回错误 (${result.status})`);
		}
		return await result.json();
	});
}

// ========== 导出测试用函数 ==========
export { _isPureMessageStartChunk, _isWebSearchTool, _applyWebSearchOverrideTargetModel, _ensureBlockForItem, _openAnthropicStream };
