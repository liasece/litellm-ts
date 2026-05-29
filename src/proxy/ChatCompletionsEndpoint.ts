/**
 * Chat Completions 代理端点
 *
 * 将 /v1/chat/completions 及其 Azure 兼容路径的请求路由到目标 LLM Provider。
 * 支持流式（SSE）和非流式两种响应模式。
 * 流式响应包含 2 秒间隔的 keep-alive 心跳。
 */

import * as crypto from "node:crypto";
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";
import { createModuleLogger } from "../core/utils/logger";
import type { Message, ModelResponse, ModelResponseStream } from "../types/openai";
import type { ProviderConfig } from "../types/provider";
import type { DrizzleDb } from "../core/db/Database";
import { calculateAndSetCost, trackSpendLog, injectResponseCostHeader, normalizeUsageForSpend } from "../spend/SpendTracker";
import { runCommonChecks } from "../auth/AuthChecks";
import type { SpendLog } from "../types/spend";
import { CallType } from "../types/spend";

const logger = createModuleLogger("Proxy:ChatCompletions");

/** 扩展 ProviderConfig，增加流式响应方法 */
interface StreamingProvider extends ProviderConfig {
	streamResponse(response: Response): AsyncGenerator<ModelResponseStream>;
}

/** 流式读取的 chunk 大小 */
const SSE_KEEPALIVE_INTERVAL_MS = 2000;

/**
 * 注册 Chat Completions 路由到 Express Router
 *
 * 覆盖以下路径：
 * - POST /v1/chat/completions（标准 OpenAI）
 * - POST /chat/completions（简写）
 * - POST /engines/:model/chat/completions（Azure 兼容）
 * - POST /openai/deployments/:model/chat/completions（Azure 兼容）
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 * @param db
 */
export function registerChatCompletionsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter, db: DrizzleDb): void {
	const paths = [
		"/v1/chat/completions",
		"/chat/completions",
		"/engines/:model/chat/completions",
		"/openai/deployments/:model/chat/completions",
	];

	const handler = createChatHandler(litellmRouter, db);

	for (const path of paths) {
		registerRoute(expressRouter, { method: "post", path: path }, handler);
	}
}

/**
 * 创建 Chat Completions 请求处理器
 * @param litellmRouter - LiteLLM Router 实例
 * @param db
 */
function createChatHandler(litellmRouter: LiteLLMRouter, db: DrizzleDb) {
	return async (req: import("express").Request, res: import("express").Response) => {
		const model = req.params.model ?? req.body.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}

		// 授权检查
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}

		const messages = req.body.messages as Message[] | undefined;
		if (!messages) {
			throw ApiError.badRequest("messages 字段缺失");
		}

		const optionalParams: Record<string, unknown> = { ...req.body };
		delete optionalParams.messages;
		delete optionalParams.model;

		// === 非流式：委托 Router.completion 处理重试和降级 ===
		if (req.body.stream !== true) {
			const startTime = new Date();
			const result = await litellmRouter.completion(model, messages, optionalParams);
			calculateAndSetCost(result as unknown as ModelResponse, model);
			const usage = (result as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
			if (req.auth && usage) {
				// GAP 3: 非流式分支也走 normalizeUsageForSpend 统一处理 input_tokens/output_tokens
				// vs prompt_tokens/completion_tokens 双字段，避免 Anthropic/Responses API 直接传回
				// usage 字典（input_tokens/output_tokens）时导致 prompt_tokens=0、completion_tokens=0、
				// cost 漏算。
				const normalized = normalizeUsageForSpend(usage);
				const endTime = new Date();
				const spendLog: SpendLog = {
					request_id: crypto.randomUUID(),
					call_type: CallType.ACompletion,
					api_key: req.auth.api_key ?? "",
					spend: 0,
					total_tokens: normalized?.total_tokens ?? (usage["total_tokens"] as number) ?? 0,
					prompt_tokens: normalized?.prompt_tokens ?? (usage["prompt_tokens"] as number) ?? 0,
					completion_tokens: normalized?.completion_tokens ?? (usage["completion_tokens"] as number) ?? 0,
					startTime: startTime.toISOString(),
					endTime: endTime.toISOString(),
					model: model,
					user: req.auth.user_id,
					team_id: req.auth.team_id,
					cache_creation_input_tokens: normalized?.cache_creation_input_tokens,
					cache_read_input_tokens: normalized?.cache_read_input_tokens,
					// GAP 10: 把 end_user_id 透传到 spend log（end_user 维度汇总依赖此字段）
					end_user_id: req.auth.end_user_id,
				};
				trackSpendLog(db, spendLog).catch((err) => logger.error("记录花费日志失败", { error: err }));
			}
			// PY: inject x-litellm-response-cost header
			if (usage && (usage as unknown as Record<string, unknown>)["cost"] !== undefined) {
				injectResponseCostHeader(res, (usage as unknown as Record<string, unknown>)["cost"] as number);
			}
			// DIFF-RT-03 / DIFF-ROUTER-RESPHEADERS-01: 把 Router 注入的 _providerHeaders 透传到响应
			// 对齐 PY `router.py:5715-5744 set_response_headers` —— 包含
			//   x-request-id / x-ratelimit-*-{tokens,requests} / retry-after /
			//   anthropic-ratelimit-* / x-litellm-model-id / x-litellm-model-group
			const providerHeaders = (result as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
			if (providerHeaders) {
				for (const [k, v] of Object.entries(providerHeaders)) {
					// 避免覆盖已有同 key 的头（injectResponseCostHeader 已经设过 x-litellm-response-cost）
					if (!res.getHeader(k)) {
						res.setHeader(k, v);
					}
				}
			}
			return result;
		}

		// === 流式响应 (SSE) ===
		await handleStreamingResponse(litellmRouter, model, messages, optionalParams, res, { auth: req.auth, db: db });
		return undefined;
	};
}

/**
 * 处理流式（SSE）响应
 *
 * 额外注入 keep-alive 心跳（SSE comment），防止负载均衡器断开连接。
 * 支持 fallback/retry：当 provider 失败时标记 cooldown 并尝试下一个部署。
 * @param litellmRouter - LiteLLM Router 实例
 * @param model - 模型名称
 * @param messages - 消息列表
 * @param optionalParams - 可选参数
 * @param res - Express 响应对象
 * @param options - 附加选项（auth, db）
 */
async function handleStreamingResponse(
	litellmRouter: LiteLLMRouter,
	model: string,
	messages: Message[],
	optionalParams: Record<string, unknown>,
	res: import("express").Response,
	options?: { auth?: import("express").Request["auth"]; db?: DrizzleDb },
): Promise<void> {
	let fallbackDepth = 0;
	const { auth, db } = options ?? {};
	let currentModel = model;
	let lastError: unknown;

	const startTime = new Date();
	let accumulatedTokens = 0;
	let totalPromptTokens = 0;
	let totalCacheCreationTokens = 0;
	let totalCacheReadTokens = 0;
	let totalCompletionTokens = 0;
	let hasRealUsage = false;

	while (true) {
		// 获取可用部署（含 cooldown 检查）
		const candidate = litellmRouter.getAvailableDeployment(currentModel);
		if (!candidate) {
			// 当前模型无可用部署 — 尝试 fallback
			const nextFallback = litellmRouter.getNextFallback(model, fallbackDepth);
			if (!nextFallback) {
				break;
			}
			fallbackDepth++;
			currentModel = nextFallback;
			continue;
		}

		const { deployment, provider } = candidate;

		// Track active request
		litellmRouter.trackActiveRequest(deployment.model_name, 1);

		const providerReq = provider.transformRequest(deployment.litellm_params.model, messages, {
			...optionalParams,
			stream: true,
		});

		try {
			// 向后端发起流式请求
			const response = await fetch(providerReq.url, {
				method: providerReq.method,
				headers: providerReq.headers,
				body: JSON.stringify(providerReq.body),
			});

			if (!response.ok) {
				const errorBody = await response.json().catch(() => ({}));
				lastError = new ApiError(response.status, `Provider 返回错误: ${JSON.stringify(errorBody)}`);
				litellmRouter.markFailed(deployment.model_name);
				// 尝试下一个 fallback
				const nextFallback = litellmRouter.getNextFallback(model, fallbackDepth);
				if (!nextFallback) {
					throw lastError;
				}
				fallbackDepth++;
				currentModel = nextFallback;
				continue;
			}

			// Provider 不支持流式或无法获取 reader 时回退到非流式
			if (!provider.supportsStreaming() || !response.body) {
				const rawBody = await response.json();
				const transformed = provider.transformResponse(deployment.litellm_params.model, rawBody);
				res.json(transformed);
				return;
			}

			// 设置 SSE 响应头
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.setHeader("X-Accel-Buffering", "no");

			// DIFF-RT-03 / DIFF-ROUTER-RESPHEADERS-01: 流式路径也透传上游 provider headers
			// （含 x-request-id / x-ratelimit-* / retry-after / anthropic-ratelimit-* / x-litellm-model-{id,group}）
			// 通过 response._providerHeaders 拿到 Router 在 _executeRequest 阶段提取的 headers。
			const providerHeaders = (response as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
			if (providerHeaders) {
				for (const [k, v] of Object.entries(providerHeaders)) {
					if (!res.getHeader(k)) {
						res.setHeader(k, v);
					}
				}
			}

			const keepAlive = setInterval(() => {
				res.write(": keepalive\n\n");
			}, SSE_KEEPALIVE_INTERVAL_MS);

			try {
				const streamProvider = provider as unknown as StreamingProvider;
				const stream = streamProvider.streamResponse(response);

				for await (const chunk of stream) {
					// 累加流式 token（从 delta content 估算）
					for (const choice of chunk.choices ?? []) {
						const delta = choice.delta;
						if (delta?.content && typeof delta.content === "string") {
							accumulatedTokens += Math.ceil(delta.content.length / 4);
						}
					}
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
					// 从流式 chunk 中提取实际 usage（部分 provider 在末尾 chunk 中返回）
					if ((chunk as unknown as Record<string, unknown>).usage) {
						const usage = (chunk as unknown as Record<string, unknown>).usage as Record<string, unknown>;
						if (usage["prompt_tokens"] != null) {
							totalPromptTokens = Number(usage["prompt_tokens"]);
							hasRealUsage = true;
						}
						if (usage["completion_tokens"] != null) {
							hasRealUsage = true;
							totalCompletionTokens = Number(usage["completion_tokens"]);
						}
						if (usage["cache_creation_input_tokens"] != null) {
							totalCacheCreationTokens = Number(usage["cache_creation_input_tokens"]);
						}
						if (usage["cache_read_input_tokens"] != null) {
							totalCacheReadTokens = Number(usage["cache_read_input_tokens"]);
						}

						if (typeof usage["prompt_tokens_details"] === "object" && usage["prompt_tokens_details"] !== null) {
							const ptd = usage["prompt_tokens_details"] as Record<string, unknown>;
							// GAP: PY 流式末 chunk 统一覆盖式赋值 (不取 max)，对齐 _transform_response_api_usage_to_chat_usage。
							//   原 TS 用 Math.max 累计导致：若中间 chunk 报过更大值，末 chunk 即便降到正确值也会被锁住。
							// eslint-disable-next-line max-depth
							if (ptd["cached_tokens"] != null) {
								totalCacheReadTokens = Number(ptd["cached_tokens"]);
							}
							// eslint-disable-next-line max-depth
							if (ptd["cache_creation_tokens"] != null) {
								totalCacheCreationTokens = Number(ptd["cache_creation_tokens"]);
							}
						}
					}
				}

				res.write("data: [DONE]\n\n");
			} catch (err) {
				logger.error("流式响应处理异常", { error: err });
				// 写入 SSE 错误事件让客户端感知
				const errorPayload = JSON.stringify({
					error: { message: String(err), type: "stream_error" },
				});
				res.write(`data: ${errorPayload}\n\n`);
			} finally {
				clearInterval(keepAlive);
				res.end();

				// 流式 spend 追踪
				if (auth && db && (hasRealUsage || accumulatedTokens > 0)) {
					const endTime = new Date();
					const spendLog: SpendLog = {
						request_id: crypto.randomUUID(),
						call_type: CallType.ACompletion,
						api_key: auth.api_key ?? "",
						spend: 0,
						total_tokens: totalPromptTokens + totalCompletionTokens,
						prompt_tokens: totalPromptTokens,
						completion_tokens: totalCompletionTokens,
						startTime: startTime.toISOString(),
						endTime: endTime.toISOString(),
						model: currentModel,
						user: auth.user_id,
						team_id: auth.team_id,
						cache_creation_input_tokens: totalCacheCreationTokens,
						cache_read_input_tokens: totalCacheReadTokens,
						// eslint-disable-next-line camelcase
						cache_hit: totalCacheReadTokens > 0,
						// GAP 10: 透传 end_user_id 到 spend log
						end_user_id: auth.end_user_id,
					};
					trackSpendLog(db, spendLog).catch((err) => logger.error("流式花费追踪失败", { error: err }));
				}
			}
			return;
		} catch (err) {
			lastError = err;
			litellmRouter.markFailed(deployment.model_name);
			// 尝试下一个 fallback
			const nextFallback = litellmRouter.getNextFallback(model, fallbackDepth);
			if (!nextFallback) {
				break;
			}
			fallbackDepth++;
			currentModel = nextFallback;
		} finally {
			litellmRouter.trackActiveRequest(deployment.model_name, -1);
		}
	}

	// 所有部署和 fallback 均失败
	throw lastError ?? ApiError.unavailable(`模型 "${model}" 当前无可用部署`);
}
