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
import { calculateAndSetCost, trackSpendLog } from "../spend/SpendTracker";
import { runCommonChecks } from "../auth/AuthChecks";
import type { SpendLog } from "../types/spend";

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
				const endTime = new Date();
				const spendLog: SpendLog = {
					request_id: crypto.randomUUID(),
					call_type: "acompletion",
					api_key: req.auth.api_key ?? "",
					spend: 0,
					total_tokens: (usage["total_tokens"] as number) ?? 0,
					prompt_tokens: (usage["prompt_tokens"] as number) ?? 0,
					completion_tokens: (usage["completion_tokens"] as number) ?? 0,
					startTime: startTime.toISOString(),
					endTime: endTime.toISOString(),
					model: model,
					user: req.auth.user_id,
					team_id: req.auth.team_id,
				};
				trackSpendLog(db, spendLog).catch((err) => logger.error("记录花费日志失败", { error: err }));
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
	let totalCompletionTokens = 0;

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
						}
						if (usage["completion_tokens"] != null) {
							totalCompletionTokens = Number(usage["completion_tokens"]);
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
				if (auth && db && accumulatedTokens > 0) {
					const endTime = new Date();
					const spendLog: SpendLog = {
						request_id: crypto.randomUUID(),
						call_type: "acompletion",
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
