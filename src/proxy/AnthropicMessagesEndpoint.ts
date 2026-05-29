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
 * - Patch 11: deferred responses stream
 * - Patch 12: SSE keep-alive ping
 * - Patch 13: Files API 转发（文件上传/列表/下载/删除）
 * - Patch 14: model_group_alias 解析回退（src/router/FallbackHandler.ts）
 * - Patch 16: Batches API 转发（批量消息创建/列表/查询/取消）
 */
import * as crypto from "node:crypto";
import type { Router, Request, Response } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { createModuleLogger } from "../core/utils/logger";
import { cleanSurrogates } from "../core/utils/text";
import { getConfig } from "../core/config";
import { calculateAndSetCost, trackSpendLog } from "../spend/SpendTracker";
import type { SpendLog } from "../types/spend";
import type { DrizzleDb } from "../core/db/Database";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { ModelResponse } from "../types/openai";

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

// Token extraction from SSE chunks (extracted to reduce nesting depth)
function _captureInputTokens(chunk: string, target: { value: number }): void {
	try {
		const m = /data: (.+)/.exec(chunk);
		if (m) {
			const p = JSON.parse(m[1]!);
			if (p.message?.usage?.input_tokens) {
				target.value = p.message.usage.input_tokens;
			}
		}
	} catch {
		/* ignore */
	}
}
function _captureOutputTokens(chunk: string, target: { value: number }): void {
	try {
		const m = /data: (.+)/.exec(chunk);
		if (m) {
			const p = JSON.parse(m[1]!);
			if (p.type === "message_delta" && p.usage?.output_tokens) {
				target.value = p.usage.output_tokens;
			}
		}
	} catch {
		/* ignore */
	}
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
 * 延迟执行上游 API 调用后才返回 async generator。
 * 调用方拿到 generator 不触发任何网络请求，只有开始迭代时才真正调用 fetch。
 * @param upstreamUrl
 * @param providerHeaders
 * @param body
 * @param model
 * @yields {string}
 */
async function* _deferredAnthropicStream(
	upstreamUrl: string,
	providerHeaders: Record<string, string>,
	body: Record<string, unknown>,
	model: string,
): AsyncGenerator<string> {
	const result = await fetch(upstreamUrl, {
		method: "POST",
		headers: { ...providerHeaders, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!result.ok) {
		const errBody = await result.text().catch(() => "");
		throw new ApiError(result.status, `Provider 返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
	}

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
				} catch {
					// 跳过无法解析的行
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Helper: get provider URL and headers for an Anthropic model via the Router.
 * @param litellmRouter
 * @param model
 * @param requestApiKey
 * @param requestAnthropicVersion
 * @throws {ApiError} 当上游 API 返回错误时
 */
function _getProviderUpstream(
	litellmRouter: LiteLLMRouter,
	model: string,
	requestApiKey?: string,
	requestAnthropicVersion?: string,
): { upstreamUrl: string; upstreamHeaders: Record<string, string> } {
	const candidate = litellmRouter.getAvailableDeployment(model);
	if (!candidate) {
		throw new ApiError(503, `No available deployment for model "${model}"`);
	}
	const { deployment, provider } = candidate;
	const apiKey = deployment.litellm_params.api_key ?? requestApiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
	const anthropicVersion = requestAnthropicVersion ?? "2023-06-01";
	const providerReq = provider.transformRequest(model, [], { api_key: apiKey, anthropic_version: anthropicVersion });
	return { upstreamUrl: providerReq.url, upstreamHeaders: providerReq.headers };
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

		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		if (!cleanBody) {
			throw ApiError.badRequest("请求体为空");
		}

		const model = cleanBody.model as string | undefined;
		if (!model) {
			throw ApiError.badRequest("缺少 model 字段");
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

		const stream = cleanBody.stream === true;

		if (stream) {
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

			// 流式 token 累加器
			const streamInputTokens = { value: 0 };
			const streamOutputTokens = { value: 0 };

			try {
				// Patch 6+15: 合成 message_start → 跳过上游首次纯 message_start
				const syntheticMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				res.write(
					formatSSE(
						"message_start",
						JSON.stringify({
							type: "message_start",
							message: {
								id: syntheticMsgId,
								type: "message",
								role: "assistant",
								model: model,
								content: [],
								usage: { input_tokens: 0, output_tokens: 0 },
							},
						}),
					),
				);

				// Patch 11: deferred stream — 通过 Router 获取 provider URL
				const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(
					litellmRouter,
					model,
					cleanBody["api_key"] as string | undefined,
					cleanBody["anthropic_version"] as string | undefined,
				);

				let firstChunk = true;
				for await (const sseChunk of _deferredAnthropicStream(upstreamUrl, upstreamHeaders, cleanBody, model as string)) {
					if (firstChunk && _isPureMessageStartChunk(sseChunk)) {
						firstChunk = false;
						_captureInputTokens(sseChunk, streamInputTokens);
						continue;
					}
					firstChunk = false;
					_captureOutputTokens(sseChunk, streamOutputTokens);
					res.write(sseChunk);
				}
			} catch (err) {
				res.write(formatSSE("error", JSON.stringify({ type: "error", error: { type: "api_error", message: String(err) } })));
				logger.error("流式响应错误", { error: String(err) });
			} finally {
				clearInterval(pingTimer);
				res.end();

				// 流式 spend 追踪
				if (db && req.auth && (streamInputTokens.value > 0 || streamOutputTokens.value > 0)) {
					const spendLog: SpendLog = {
						request_id: crypto.randomUUID(),
						call_type: "amessages",
						api_key: req.auth.api_key ?? "",
						spend: 0,
						total_tokens: streamInputTokens.value + streamOutputTokens.value,
						prompt_tokens: streamInputTokens.value,
						completion_tokens: streamOutputTokens.value,
						startTime: new Date().toISOString(),
						endTime: new Date().toISOString(),
						model: model,
						user: req.auth.user_id,
						team_id: req.auth.team_id,
					};
					trackSpendLog(db, spendLog).catch((err) => logger.error("Anthropic 流式花费追踪失败", { error: err }));
				}
			}
			return;
		}

		// 非流式响应 — 通过 Router 获取 provider URL
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(
			litellmRouter,
			model,
			cleanBody["api_key"] as string | undefined,
			cleanBody["anthropic_version"] as string | undefined,
		);

		const result = await fetch(upstreamUrl, {
			method: "POST",
			headers: { ...upstreamHeaders, "Content-Type": "application/json" },
			body: JSON.stringify(cleanBody),
		});

		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `Provider 返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}

		const responseData = await result.json();
		calculateAndSetCost(responseData as ModelResponse, model);

		// 非流式 spend 追踪
		if (db && req.auth) {
			const usage = (responseData as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
			if (usage) {
				const inputTokens = (usage["input_tokens"] as number) ?? 0;
				const outputTokens = (usage["output_tokens"] as number) ?? 0;
				const spendLog: SpendLog = {
					request_id: crypto.randomUUID(),
					call_type: "amessages",
					api_key: req.auth.api_key ?? "",
					spend: 0,
					total_tokens: inputTokens + outputTokens,
					prompt_tokens: inputTokens,
					completion_tokens: outputTokens,
					startTime: new Date().toISOString(),
					endTime: new Date().toISOString(),
					model: model,
					user: req.auth.user_id,
					team_id: req.auth.team_id,
				};
				trackSpendLog(db, spendLog).catch((err) => logger.error("Anthropic 花费追踪失败", { error: err }));
			}
		}

		return responseData;
	});

	// POST /v1/messages/count_tokens — Patch 10: 转发到上游
	registerRoute(router, { method: "post", path: "/v1/messages/count_tokens" }, async (req) => {
		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		const model = cleanBody.model as string | undefined;
		if (!model) {
			throw ApiError.badRequest("缺少 model 字段");
		}
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(
			litellmRouter,
			model,
			cleanBody["api_key"] as string | undefined,
			cleanBody["anthropic_version"] as string | undefined,
		);
		const countUrl = upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/count_tokens");
		const result = await fetch(countUrl, {
			method: "POST",
			headers: {
				...upstreamHeaders,
				"Content-Type": "application/json",
				"anthropic-beta": "token-counting-2024-11-01",
			},
			body: JSON.stringify(cleanBody),
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
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const filesUrl = upstreamUrl.replace(/\/v1\/messages$/, "/v1/files");
		const result = await fetch(filesUrl, {
			method: "POST",
			headers: { ...upstreamHeaders, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `Files 上传返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const filesUrl = upstreamUrl.replace(/\/v1\/messages$/, "/v1/files");
		const result = await fetch(filesUrl, { headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 列表返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files/:id" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const fileUrl = upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}`);
		const result = await fetch(fileUrl, { headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 查询返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/files/:id/content" }, async (req, res) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const contentUrl = upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}/content`);
		const result = await fetch(contentUrl, { headers: upstreamHeaders });
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
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const fileUrl = upstreamUrl.replace(/\/v1\/messages$/, `/v1/files/${req.params["id"]}`);
		const result = await fetch(fileUrl, { method: "DELETE", headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Files 删除返回错误 (${result.status})`);
		}
		return await result.json();
	});

	// ========== Patch 16: Batches API 转发 ==========

	registerRoute(router, { method: "post", path: "/v1/messages/batches" }, async (req) => {
		const cleanBody = sanitizeRequestBody(req.body) as Record<string, unknown>;
		const model = (cleanBody.model as string) ?? "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const batchesUrl = upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/batches");
		const result = await fetch(batchesUrl, {
			method: "POST",
			headers: { ...upstreamHeaders, "Content-Type": "application/json" },
			body: JSON.stringify(cleanBody),
		});
		if (!result.ok) {
			const errBody = await result.text().catch(() => "");
			throw new ApiError(result.status, `Batches 创建返回错误 (${result.status}): ${errBody.slice(0, 200)}`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/messages/batches" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const batchesUrl = upstreamUrl.replace(/\/v1\/messages$/, "/v1/messages/batches");
		const result = await fetch(batchesUrl, { headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 列表返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "get", path: "/v1/messages/batches/:id" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const batchUrl = upstreamUrl.replace(/\/v1\/messages$/, `/v1/messages/batches/${req.params["id"]}`);
		const result = await fetch(batchUrl, { headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 查询返回错误 (${result.status})`);
		}
		return await result.json();
	});

	registerRoute(router, { method: "post", path: "/v1/messages/batches/:id/cancel" }, async (req) => {
		const model = "claude-sonnet-4-20250514";
		const { upstreamUrl, upstreamHeaders } = _getProviderUpstream(litellmRouter, model);
		const cancelUrl = upstreamUrl.replace(/\/v1\/messages$/, `/v1/messages/batches/${req.params["id"]}/cancel`);
		const result = await fetch(cancelUrl, { method: "POST", headers: upstreamHeaders });
		if (!result.ok) {
			throw new ApiError(result.status, `Batches 取消返回错误 (${result.status})`);
		}
		return await result.json();
	});
}

// ========== 导出测试用函数 ==========
export { _isPureMessageStartChunk, _isWebSearchTool, _applyWebSearchOverrideTargetModel, _ensureBlockForItem, _deferredAnthropicStream };
