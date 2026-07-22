/**
 * Chat Completions 代理端点
 *
 * 将 /v1/chat/completions 及其 Azure 兼容路径的请求路由到目标 LLM Provider。
 * 支持流式（SSE）和非流式两种响应模式。
 * 流式响应包含 2 秒间隔的 keep-alive 心跳。
 */

import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { stripInternalFields } from "../core/api/stripInternalFields";
import { ApiError } from "../core/api/ApiError";
import { buildInvalidModelError, formatInvalidModelMessage, CHAT_COMPLETIONS_ROUTE_NAME } from "../router/RouterExecution";
import type { Router as LiteLLMRouter } from "../router/Router";
import { createModuleLogger } from "../core/utils/logger";
import type { Message, ModelResponse, ModelResponseStream, ThinkingBlock, ToolCall, Usage } from "../types/openai";
import type { ProviderConfig } from "../types/provider";
import type { DrizzleDb } from "../core/db/Database";
import { calculateAndSetCost, trackSpendLog, injectResponseCostHeader, buildSpendLogFromRequest } from "../spend/SpendTracker";
import { runCommonChecks } from "../auth/AuthChecks";
import { CallType, SpendLogStatus } from "../types/spend";
import { buildDeploymentSpendInfo, type DeploymentSpendInfo } from "../router/RouterSpendInfo";

const logger = createModuleLogger("Proxy:ChatCompletions");

/** 扩展 ProviderConfig，增加流式响应方法 */
interface StreamingProvider extends ProviderConfig {
	streamResponse(response: Response): AsyncGenerator<ModelResponseStream>;
}

/** 流式读取的 chunk 大小 */
const SSE_KEEPALIVE_INTERVAL_MS = 2000;

interface ToolCallAccumulator {
	id: string;
	type: "function";
	name: string;
	arguments: string;
}

interface ChoiceAccumulator {
	index: number;
	role: string;
	content: string;
	reasoningContent: string;
	thinkingBlocks: ThinkingBlock[];
	providerSpecificFields: Record<string, unknown>;
	finishReason: string | null;
	toolCalls: Map<number, ToolCallAccumulator>;
}

interface ChatStreamAccumulator {
	id?: string;
	created?: number;
	model?: string;
	choices: Map<number, ChoiceAccumulator>;
	usage?: Usage;
	estimatedCompletionTokens: number;
}

function mergeProviderSpecificFields(target: Record<string, unknown>, source: Record<string, unknown> | undefined): void {
	if (!source) {
		return;
	}
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];
		if (Array.isArray(current) && Array.isArray(value)) {
			target[key] = [...current, ...value];
		} else {
			target[key] = value;
		}
	}
}

function accumulateChatChunk(state: ChatStreamAccumulator, chunk: ModelResponseStream): void {
	state.id ??= chunk.id;
	state.created ??= chunk.created;
	state.model ??= chunk.model;
	const internalUsage = chunk._usage ?? (chunk as unknown as { usage?: Usage }).usage;
	if (internalUsage) {
		state.usage = { ...internalUsage };
	}
	for (const choice of chunk.choices ?? []) {
		let accumulated = state.choices.get(choice.index);
		if (!accumulated) {
			accumulated = {
				index: choice.index,
				role: "assistant",
				content: "",
				reasoningContent: "",
				thinkingBlocks: [],
				providerSpecificFields: {},
				finishReason: null,
				toolCalls: new Map<number, ToolCallAccumulator>(),
			};
			state.choices.set(choice.index, accumulated);
		}
		const delta = choice.delta;
		if (typeof delta?.role === "string") {
			accumulated.role = delta.role;
		}
		if (typeof delta?.content === "string") {
			accumulated.content += delta.content;
			state.estimatedCompletionTokens += Math.ceil(delta.content.length / 4);
		}
		if (typeof delta?.reasoning_content === "string") {
			accumulated.reasoningContent += delta.reasoning_content;
		}
		if (delta?.thinking_blocks) {
			accumulated.thinkingBlocks.push(...delta.thinking_blocks);
		}
		mergeProviderSpecificFields(accumulated.providerSpecificFields, delta?.provider_specific_fields);
		for (const toolCallDelta of delta?.tool_calls ?? []) {
			const existing = accumulated.toolCalls.get(toolCallDelta.index) ?? {
				id: "",
				type: "function" as const,
				name: "",
				arguments: "",
			};
			if (toolCallDelta.id) {
				existing.id += toolCallDelta.id;
			}
			if (toolCallDelta.function?.name) {
				existing.name += toolCallDelta.function.name;
			}
			if (toolCallDelta.function?.arguments) {
				existing.arguments += toolCallDelta.function.arguments;
			}
			accumulated.toolCalls.set(toolCallDelta.index, existing);
		}
		if (choice.finish_reason !== null) {
			accumulated.finishReason = choice.finish_reason;
		}
	}
}

function buildAggregatedChatResponse(state: ChatStreamAccumulator, fallbackModel: string): ModelResponse | undefined {
	if (!state.id && state.choices.size === 0) {
		return undefined;
	}
	return {
		id: state.id ?? "",
		object: "chat.completion",
		created: state.created ?? Math.floor(Date.now() / 1000),
		model: state.model ?? fallbackModel,
		choices: [...state.choices.values()]
			.sort((left, right) => left.index - right.index)
			.map((choice) => {
				const toolCalls: ToolCall[] = [...choice.toolCalls.entries()]
					.sort(([left], [right]) => left - right)
					.map(([, toolCall]) => ({
						id: toolCall.id,
						type: toolCall.type,
						function: { name: toolCall.name, arguments: toolCall.arguments },
					}));
				return {
					index: choice.index,
					finish_reason: choice.finishReason ?? "",
					message: {
						role: choice.role,
						content: choice.content || toolCalls.length === 0 ? choice.content : null,
						...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
						...(choice.reasoningContent ? { reasoning_content: choice.reasoningContent } : {}),
						...(choice.thinkingBlocks.length > 0 ? { thinking_blocks: choice.thinkingBlocks } : {}),
						...(Object.keys(choice.providerSpecificFields).length > 0
							? { provider_specific_fields: choice.providerSpecificFields }
							: {}),
					},
				};
			}),
		...(state.usage ? { usage: state.usage } : {}),
	};
}

/**
 * 注册 Chat Completions 路由到 Express Router
 *
 * 覆盖以下路径：
 * - POST /v1/chat/completions（标准 OpenAI）
 * - POST /chat/completions（简写）
 * - POST /engines/{model:path}/chat/completions（Azure 兼容）
 * - POST /openai/deployments/{model:path}/chat/completions（Azure 兼容）
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 * @param db
 */
export function registerChatCompletionsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter, db: DrizzleDb): void {
	const paths = ["/v1/chat/completions", "/chat/completions", "/engines/*/chat/completions", "/openai/deployments/*/chat/completions"];

	const handler = createChatHandler(litellmRouter, db);

	for (const path of paths) {
		registerRoute(expressRouter, { method: "post", path: path }, handler);
	}
}

function getPathModel(req: import("express").Request): unknown {
	return req.params.model ?? req.params[0];
}

/**
 * 创建 Chat Completions 请求处理器
 * @param litellmRouter - LiteLLM Router 实例
 * @param db
 */
function createChatHandler(litellmRouter: LiteLLMRouter, db: DrizzleDb) {
	return async (req: import("express").Request, res: import("express").Response) => {
		const model = getPathModel(req) ?? req.body.model;
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
			try {
				const result = await litellmRouter.completion(model, messages, optionalParams);
				// PY 非流式 completionStartTime：上游响应返回（completion 解析完成）的时间点，
				// TTFT = completionStartTime - startTime（含输入处理与排队时长）
				const completionStartTime = new Date();
				// 批次 9: 实际执行 deployment 的 spend 归因（provider/api_base/model_id/model_info 价格）
				const spendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
				calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
				const usage = (result as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
				if (req.auth) {
					const endTime = new Date();
					const spendLog = buildSpendLogFromRequest({
						req: req,
						auth: req.auth,
						callType: CallType.ACompletion,
						model: model,
						// PY: model_group=原请求逻辑模型名（fallback 时仍为原请求名）
						modelGroup: model,
						modelId: spendInfo?.modelId,
						customLlmProvider: spendInfo?.customLlmProvider,
						apiBase: spendInfo?.apiBase,
						customCostPerToken: spendInfo?.customCostPerToken,
						deploymentModel: spendInfo?.deploymentModel,
						startTime: startTime,
						endTime: endTime,
						completionStartTime: completionStartTime,
						messages: messages,
						response: result,
						usage: usage,
						status: SpendLogStatus.Success,
					});
					trackSpendLog(db, spendLog).catch((err) => logger.error("记录花费日志失败", { error: err }));
				}
				if (usage && (usage as unknown as Record<string, unknown>)["cost"] !== undefined) {
					injectResponseCostHeader(res, (usage as unknown as Record<string, unknown>)["cost"] as number);
				}
				const providerHeaders = (result as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
				if (providerHeaders) {
					for (const [k, v] of Object.entries(providerHeaders)) {
						if (!res.getHeader(k)) {
							res.setHeader(k, v);
						}
					}
				}
				// PY 对齐：直连（未发生 fallback）时响应 model 改写为请求的逻辑模型名；
				// fallback（depth>0）时保持上游返回的模型名。
				// 须在 registerRoute 出口剥离内部字段之前读取 _fallbackDepth。
				if (result._fallbackDepth === 0) {
					result.model = model;
				}
				return result;
			} catch (error) {
				if (req.auth) {
					const endTime = new Date();
					const failureSpendLog = buildSpendLogFromRequest({
						req: req,
						auth: req.auth,
						callType: CallType.ACompletion,
						model: model,
						startTime: startTime,
						endTime: endTime,
						messages: messages,
						error: error,
						status: SpendLogStatus.Failure,
					});
					trackSpendLog(db, failureSpendLog).catch((err) => logger.error("记录失败花费日志失败", { error: err }));
				}
				throw error;
			}
		}

		// === 流式响应 (SSE) ===
		await handleStreamingResponse(litellmRouter, model, messages, optionalParams, res, { req: req, db: db });
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
 * @param context - 完整请求与数据库上下文
 */
async function handleStreamingResponse(
	litellmRouter: LiteLLMRouter,
	model: string,
	messages: Message[],
	optionalParams: Record<string, unknown>,
	res: import("express").Response,
	context: { req: import("express").Request; db: DrizzleDb },
): Promise<void> {
	const { req, db } = context;
	let fallbackDepth = 0;
	let currentModel = model;
	let lastError: unknown;
	const startTime = new Date();

	while (true) {
		const candidate = litellmRouter.getAvailableDeployment(currentModel);
		if (!candidate) {
			const nextFallback = litellmRouter.getNextFallback(currentModel, 0);
			if (!nextFallback) {
				break;
			}
			fallbackDepth++;
			currentModel = nextFallback;
			continue;
		}

		const { deployment, provider } = candidate;
		litellmRouter.trackActiveRequest(deployment.model_name, 1);
		const providerReq = provider.transformRequest(deployment.litellm_params.model, messages, {
			...deployment.litellm_params,
			...optionalParams,
			stream: true,
		});

		try {
			const response = await fetch(providerReq.url, {
				method: providerReq.method,
				headers: providerReq.headers,
				body: JSON.stringify(providerReq.body),
			});
			if (!response.ok) {
				const errorBody = await response.json().catch(() => ({}));
				throw new ApiError(response.status, `Provider 返回错误: ${JSON.stringify(errorBody)}`);
			}

			const spendInfo = buildDeploymentSpendInfo(deployment, providerReq.url);
			if (!provider.supportsStreaming() || !response.body) {
				const rawBody = await response.json();
				const transformed = provider.transformResponse(deployment.litellm_params.model, rawBody);
				const completionStartTime = new Date();
				if (fallbackDepth === 0) {
					transformed.model = model;
				}
				calculateAndSetCost(transformed, model, spendInfo.customCostPerToken);
				if (req.auth) {
					const spendLog = buildSpendLogFromRequest({
						req: req,
						auth: req.auth,
						callType: CallType.ACompletion,
						model: model,
						modelGroup: model,
						modelId: spendInfo.modelId,
						customLlmProvider: spendInfo.customLlmProvider,
						apiBase: spendInfo.apiBase,
						customCostPerToken: spendInfo.customCostPerToken,
						deploymentModel: spendInfo.deploymentModel,
						startTime: startTime,
						endTime: new Date(),
						completionStartTime: completionStartTime,
						messages: messages,
						response: transformed,
						usage: transformed.usage as unknown as Record<string, unknown> | undefined,
						status: SpendLogStatus.Success,
					});
					trackSpendLog(db, spendLog).catch((err) => logger.error("流式 JSON fallback 花费追踪失败", { error: err }));
				}
				res.json(stripInternalFields(transformed));
				return;
			}

			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.setHeader("X-Accel-Buffering", "no");
			const providerHeaders = (response as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
			for (const [key, value] of Object.entries(providerHeaders ?? {})) {
				if (!res.getHeader(key)) {
					res.setHeader(key, value);
				}
			}

			let clientDisconnected = false;
			res.on("close", () => {
				if (!res.writableEnded) {
					clientDisconnected = true;
				}
			});
			const keepAlive = setInterval(() => {
				if (!clientDisconnected) {
					res.write(": keepalive\n\n");
				}
			}, SSE_KEEPALIVE_INTERVAL_MS);
			const accumulator: ChatStreamAccumulator = { choices: new Map(), estimatedCompletionTokens: 0 };
			let streamError: unknown;
			let completionStartTime: Date | undefined;

			try {
				const stream = (provider as unknown as StreamingProvider).streamResponse(response);
				for await (const chunk of stream) {
					if (fallbackDepth === 0) {
						chunk.model = model;
					}
					completionStartTime ??= new Date();
					accumulateChatChunk(accumulator, chunk);
					if (!clientDisconnected) {
						res.write(`data: ${JSON.stringify(stripInternalFields(chunk))}\n\n`);
					}
				}
				if (!clientDisconnected) {
					res.write("data: [DONE]\n\n");
				}
			} catch (err) {
				streamError = err;
				logger.error("流式响应处理异常", { error: err });
				if (!clientDisconnected) {
					res.write(`data: ${JSON.stringify({ error: { message: String(err), type: "stream_error" } })}\n\n`);
				}
			} finally {
				clearInterval(keepAlive);
				if (!res.writableEnded) {
					res.end();
				}
				if (req.auth) {
					const responseForLog = buildAggregatedChatResponse(accumulator, fallbackDepth === 0 ? model : currentModel);
					const usage =
						accumulator.usage ??
						(accumulator.estimatedCompletionTokens > 0
							? {
									prompt_tokens: 0,
									completion_tokens: accumulator.estimatedCompletionTokens,
									total_tokens: accumulator.estimatedCompletionTokens,
								}
							: undefined);
					const spendLog = buildSpendLogFromRequest({
						req: req,
						auth: req.auth,
						callType: CallType.ACompletion,
						model: model,
						modelGroup: model,
						modelId: spendInfo.modelId,
						customLlmProvider: spendInfo.customLlmProvider,
						apiBase: spendInfo.apiBase,
						customCostPerToken: spendInfo.customCostPerToken,
						deploymentModel: spendInfo.deploymentModel,
						startTime: startTime,
						endTime: new Date(),
						completionStartTime: completionStartTime,
						messages: messages,
						response: responseForLog,
						usage: usage as unknown as Record<string, unknown> | undefined,
						error: streamError,
						status: streamError === undefined ? SpendLogStatus.Success : SpendLogStatus.Failure,
					});
					trackSpendLog(db, spendLog).catch((err) => logger.error("流式花费追踪失败", { error: err }));
				}
			}
			return;
		} catch (err) {
			lastError = err;
			litellmRouter.markFailed(deployment.model_name);
			const nextFallback = litellmRouter.getNextFallback(currentModel, 0);
			if (!nextFallback) {
				break;
			}
			fallbackDepth++;
			currentModel = nextFallback;
		} finally {
			litellmRouter.trackActiveRequest(deployment.model_name, -1);
		}
	}

	// 所有部署和 fallback 均失败；lastError 存在说明打到过 provider（透传其错误）。
	// 无 lastError 说明连候选部署都没有，按模型存在性分流（对齐 PY route_llm_request
	// 校验层与非流式 RouterExecution 的 hasModel 判定）：
	// 模型不存在 → 400 ProxyModelNotFoundError；模型存在但全部署冷却 → 429 no-deployments。
	if (lastError) {
		throw lastError;
	}
	if (!litellmRouter.hasModel(model)) {
		throw buildInvalidModelError(formatInvalidModelMessage(CHAT_COMPLETIONS_ROUTE_NAME, model));
	}
	throw ApiError.noDeploymentsAvailable(model, litellmRouter.getNoAvailableDeploymentInfo(model));
}
