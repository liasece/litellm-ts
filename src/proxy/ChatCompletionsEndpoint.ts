import { redactConfiguredSecrets } from "../core/api/redactConfiguredSecrets";
import { startSseKeepalive } from "./SseKeepalive";
import { getDeploymentKey } from "../router/RouterModelGroupCache";
import { resolveCodingClientModel } from "./CodingClientModels";
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
import { isForwardableUpstreamHeader } from "../core/api/upstreamHeaders";
import { buildInvalidModelError, formatInvalidModelMessage, CHAT_COMPLETIONS_ROUTE_NAME } from "../router/RouterExecution";
import { describeUpstreamErrorBody, executeProviderRequest } from "../router/ProviderRequestExecutor";
import type { Router as LiteLLMRouter } from "../router/Router";
import { createModuleLogger } from "../core/utils/logger";
import type { Message, ModelResponse, ModelResponseStream, ThinkingBlock, ToolCall, Usage } from "../types/openai";
import type { ProviderConfig } from "../types/provider";
import type { DrizzleDb } from "../core/db/Database";
import {
	calculateAndSetCost,
	trackSpendLog,
	injectResponseCostHeader,
	buildSpendLogFromRequest,
	checkpointActiveRequest,
	releaseSpend,
} from "../spend/SpendTracker";
import { StreamingCheckpointScheduler } from "../spend/StreamingCheckpointScheduler";
import type { StreamingCheckpoint } from "../spend/StreamingCheckpointScheduler";
import { createEndpointSpendLifecycle, reserveEndpointSpend, type EndpointSpendLifecycle } from "../spend/SpendReservation";
import { runCommonChecks } from "../auth/AuthChecks";
import { CallType, SpendLogStatus } from "../types/spend";
import { buildDeploymentSpendInfo, type DeploymentSpendInfo } from "../router/RouterSpendInfo";
import {
	appendModelResolutionTrace,
	appendRoutingTrace,
	copyModelResolutionChain,
	copyRoutingTrace,
	createModelResolutionTraceCollector,
	getResultModelResolutionMetadata,
	type ModelResolutionTraceCollector,
} from "../router/ModelResolutionTrace";
import { getConfig } from "../core/config";
import {
	buildOpenAISearchContinuation,
	mergeAgenticLoopUsage,
	executeWebSearchCalls,
	extractOpenAIWebSearchCalls,
	resolveGooglePseSearchConfig,
} from "../websearch/WebSearchInterceptor";
import { applyReasoningEffortOverride } from "../router/ReasoningEffortOverride";
import { prepareOpenAIVisionRequest } from "../capabilities/VisionCapability";
import {
	createImageGenerationCapabilityAuditHook,
	createVisionCapabilityAuditHook,
	createWebCapabilityAuditHook,
} from "../capabilities/BuiltinCapabilityAudit";
import { prepareOpenAIImageGenerationRequest } from "../capabilities/ImageGenerationCapability";
import { createVisionImageStore, type VisionImageStore } from "../capabilities/VisionImageStore";
import { runOpenAIBuiltinCapabilityAgentLoop } from "../capabilities/BuiltinCapabilityRunner";
import { prepareOpenAIWebRequest, type PreparedWebRequest } from "../capabilities/WebCapability";
import {
	attachUpstreamLogContext,
	createUpstreamLogContext,
	getUpstreamLogContext,
	type UpstreamLogContext,
} from "../router/UpstreamLogContext";

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

export interface ChatStreamAccumulator {
	id?: string;
	created?: number;
	model?: string;
	choices: Map<number, ChoiceAccumulator>;
	usage?: Usage;
	estimatedCompletionTokens: number;
}

function shouldIncludeStreamUsage(optionalParams: Record<string, unknown>): boolean {
	const streamOptions = optionalParams["stream_options"];
	return (
		typeof streamOptions === "object" && streamOptions !== null && (streamOptions as Record<string, unknown>)["include_usage"] === true
	);
}

function toOpenAIUsage(usage: Usage): Usage {
	return {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		...(typeof usage.cost === "number" && Number.isFinite(usage.cost) ? { cost: usage.cost } : {}),
		...(usage.prompt_tokens_details ? { prompt_tokens_details: usage.prompt_tokens_details } : {}),
		...(usage.completion_tokens_details ? { completion_tokens_details: usage.completion_tokens_details } : {}),
	};
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

/**
 * 把一个上游 chunk 累加进流式状态。
 *
 * 只做纯累加、不做任何 I/O，便于在流式转发前同步判断是否需要额外事件（如 usage 块）。
 * @param state - 本次流的累积状态，会被就地修改
 * @param chunk - 上游返回的单个 chunk
 */
export function accumulateChatChunk(state: ChatStreamAccumulator, chunk: ModelResponseStream): void {
	state.id ??= chunk.id;
	state.created ??= chunk.created;
	state.model ??= chunk.model;
	const internalUsage = chunk._usage ?? chunk.usage ?? undefined;
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
 * 流式累积后构造完整响应，并为「上游流式未提供 usage」的场景补 estimatedCompletionTokens
 * 估算，保证非流式下游拿到的响应与非流式 completion 等价（含 usage）。
 * @param state
 * @param fallbackModel
 * @param streamResult
 */
export function finalizeStreamedCompletion(
	state: ChatStreamAccumulator,
	fallbackModel: string,
	streamResult: Record<string, unknown>,
): Record<string, unknown> {
	const response = buildAggregatedChatResponse(state, fallbackModel);
	if (response === undefined) {
		return streamResult;
	}
	if (!response.usage && state.estimatedCompletionTokens > 0) {
		response.usage = {
			prompt_tokens: 0,
			completion_tokens: state.estimatedCompletionTokens,
			total_tokens: state.estimatedCompletionTokens,
		};
	}
	const result = response as unknown as Record<string, unknown>;
	// 合并流式返回里的内部字段（_fallbackDepth/_spendInfo/_providerHeaders 等），保证 agent loop / 下游
	// 拿到和非流式 completion 等价的结果（含计费与追踪元数据，而非流式包装字段）。
	for (const [key, value] of Object.entries(streamResult)) {
		if (key.startsWith("_")) {
			result[key] = value;
		}
	}
	return result;
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
	registerRoute(
		expressRouter,
		{
			method: "post",
			path: "/cursor/chat/completions",
			matches: (req) => req.body && "messages" in req.body && !("input" in req.body),
		},
		(req, res) => {
			req.body = resolveCodingClientModel(req.body, litellmRouter, true);
			return handler(req, res);
		},
	);

	for (const path of paths) {
		registerRoute(expressRouter, { method: "post", path: path }, handler);
	}
}

/**
 * Find unvisited own-chain or root-chain fallbacks without switching after semantic output.
 * @param router
 * @param current
 * @param original
 * @param visited
 */
function getNextStreamingFallback(router: LiteLLMRouter, current: string, original: string, visited: string[]) {
	const limit = router.maxFallbacks ?? 5;
	if (visited.length >= limit) {
		return null;
	}
	const fallbackResult = (fallback: string | null) => {
		if (fallback === null) {
			return null;
		}
		return { inputModel: fallback, resolvedModel: fallback, resolutionPath: [fallback] };
	};
	const resolve = (model: string, index: number) =>
		router.getNextFallbackWithTrace?.(model, index) ?? fallbackResult(router.getNextFallback(model, index));
	const own = resolve(current, 0);
	if (own && !visited.includes(own.resolvedModel)) {
		return own;
	}
	for (let index = 0; index < limit; index++) {
		const fallback = resolve(original, index);
		if (fallback && !visited.includes(fallback.resolvedModel)) {
			return fallback;
		}
	}
	return null;
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
		const originalRequestBody = structuredClone(req.body) as Record<string, unknown>;
		const originalMessages = originalRequestBody["messages"] as Message[];

		const optionalParams: Record<string, unknown> = { ...req.body };
		delete optionalParams.messages;
		delete optionalParams.model;
		const webSearchAbortController = new AbortController();
		const abortWebSearch = (): void => {
			// 正常写完响应后 close 也会触发；此时中止会把成功请求误记成 AbortError 失败。
			if (res.writableEnded || res.writableFinished) {
				return;
			}
			webSearchAbortController.abort();
		};
		req.once("aborted", abortWebSearch);
		res.once("close", abortWebSearch);
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, req, model, req.body, {
			callType: CallType.ACompletion,
		});
		const spendRequestId = spendReservation?.requestId;
		const spendLifecycle = createEndpointSpendLifecycle(spendReservation);
		const visionAudit = createVisionCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });
		const imageGenerationAudit = createImageGenerationCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });

		const webAudit = createWebCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });
		const visionImageStore = createVisionImageStore(db);
		const modelResolutionTrace = createModelResolutionTraceCollector();
		// 非流式路径同样向上游请求流式（需求：litellm 自身需要流式输出以做 checkpoint），
		// completeWithResolutionTrace 在流结束后返回累积的完整响应，下游仍拿到一次性非流式响应。
		let currentAccumulator: ChatStreamAccumulator | undefined;
		// 非流式路径向上游请求流式后，从 streamResult 提取上游上下文供 checkpoint 记录，使
		// 进行中请求的日志详情也能展示 Upstream 请求/响应。
		let currentUpstreamLogContext: UpstreamLogContext | undefined;
		const checkpointRequestId = spendRequestId;
		let streamingCheckpointScheduler: StreamingCheckpointScheduler<StreamingCheckpoint> | undefined;
		if (checkpointRequestId !== undefined && db !== undefined) {
			streamingCheckpointScheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
				serialize: () => {
					const acc = currentAccumulator;
					if (!acc) {
						return null;
					}
					const response = buildAggregatedChatResponse(acc, model);
					const usage =
						acc.usage ??
						(acc.estimatedCompletionTokens > 0
							? {
									prompt_tokens: 0,
									completion_tokens: acc.estimatedCompletionTokens,
									total_tokens: acc.estimatedCompletionTokens,
								}
							: undefined);
					if (response === undefined && usage === undefined) {
						return null;
					}
					return {
						protocol: "chat_completions",
						state: "in_progress",
						response: (response ?? null) as Record<string, unknown> | null,
						usage: (usage ?? null) as Record<string, unknown> | null,
						upstream_request: (currentUpstreamLogContext?.request ?? null) as Record<string, unknown> | null,
						upstream_response: (currentUpstreamLogContext?.response ?? null) as Record<string, unknown> | null,
					};
				},
				write: (checkpoint) => checkpointActiveRequest(db, checkpointRequestId, checkpoint, "streaming_execution"),
			});
		}

		const completeWithResolutionTrace = async (
			completionModel: string,
			completionMessages: Message[],
			params: Record<string, unknown> = optionalParams,
		) => {
			// 向上游请求流式，累积后返回完整响应：既满足下游非流式契约，又在流式过程中 checkpoint。
			const streamParams = { ...params, stream: true };
			const streamResult =
				typeof litellmRouter.resolveModelGroupWithTrace === "function"
					? await litellmRouter.completion(completionModel, completionMessages, streamParams, modelResolutionTrace)
					: await litellmRouter.completion(completionModel, completionMessages, streamParams);
			const stream = (streamResult as { stream?: AsyncGenerator<ModelResponseStream> })["stream"];
			if (stream === undefined) {
				return streamResult;
			}
			const accumulator: ChatStreamAccumulator = { choices: new Map(), estimatedCompletionTokens: 0 };
			currentAccumulator = accumulator;
			currentUpstreamLogContext = getUpstreamLogContext(streamResult);
			for await (const chunk of stream) {
				if (chunk && typeof chunk === "object") {					accumulateChatChunk(accumulator, chunk as ModelResponseStream);
					streamingCheckpointScheduler?.onChunk();
				}
			}
			return finalizeStreamedCompletion(accumulator, completionModel, streamResult);
		};
		try {
			spendLifecycle.markProviderStarted();

			// === 非流式：委托 Router.completion 处理重试和降级 ===
			if (req.body.stream !== true) {
				const startTime = new Date();
				let initialResult: Record<string, unknown> | undefined;
				let usageCalculated = false;
				try {
					let result = await runOpenAIBuiltinCapabilityAgentLoop(
						litellmRouter,
						model,
						messages as unknown as Array<Record<string, unknown>>,
						optionalParams,
						completeWithResolutionTrace,
						{
							visionAudit: visionAudit,
							imageGenerationAudit: imageGenerationAudit,
							webAudit: webAudit,
							visionImageStore: visionImageStore,
						},
					);
					initialResult = result;
					const requestTools = Array.isArray(optionalParams["tools"]) ? optionalParams["tools"] : [];
					const searchCalls = extractOpenAIWebSearchCalls(result, requestTools);
					if (searchCalls.length > 0) {
						const initialSpendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
						calculateAndSetCost(result as unknown as ModelResponse, model, initialSpendInfo?.customCostPerToken);
						const searchConfig = resolveGooglePseSearchConfig(getConfig(), initialSpendInfo?.customLlmProvider);
						if (searchConfig) {
							const searchResults = await executeWebSearchCalls(searchCalls, searchConfig, webSearchAbortController.signal);
							const continuation = buildOpenAISearchContinuation(result, searchCalls, searchResults);
							result = await completeWithResolutionTrace(model, [...messages, ...continuation] as unknown as Message[]);
							const finalSpendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
							calculateAndSetCost(result as unknown as ModelResponse, model, finalSpendInfo?.customCostPerToken);
							mergeAgenticLoopUsage(result, initialResult, searchCalls.length);
							usageCalculated = true;
						}
					}
					// PY 非流式 completionStartTime：上游响应返回（completion 解析完成）的时间点，
					// TTFT = completionStartTime - startTime（含输入处理与排队时长）
					const completionStartTime = new Date();
					// 批次 9: 实际执行 deployment 的 spend 归因（provider/api_base/model_id/model_info 价格）
					const spendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
					if (!usageCalculated) {
						calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
					}
					const usage = (result as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
					if (req.auth) {
						const spendLog = await buildSpendLogFromRequest({
							req: req,
							requestId: spendRequestId,
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
							endTime: new Date(),
							completionStartTime: completionStartTime,
							messages: originalMessages,
							proxyServerRequestBody: originalRequestBody,
							response: result,
							upstreamLogContext: getUpstreamLogContext(result),
							usage: usage,
							status: SpendLogStatus.Success,
							attemptedRetries: modelResolutionTrace.fallbackDepth,
							maxRetries: litellmRouter.maxFallbacks,
							fallbackModels: [...modelResolutionTrace.fallbackModels],
							modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
							routingTrace: copyRoutingTrace(modelResolutionTrace),
						});
						await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
					}
					if (usage && (usage as unknown as Record<string, unknown>)["cost"] !== undefined) {
						injectResponseCostHeader(res, (usage as unknown as Record<string, unknown>)["cost"] as number);
					}
					const providerHeaders = (result as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
					if (providerHeaders) {
						for (const [k, v] of Object.entries(providerHeaders)) {
							if (isForwardableUpstreamHeader(k) && !res.getHeader(k)) {
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
					if (spendLifecycle.isFinalized()) {
						throw error;
					}
					if (req.auth) {
						const endTime = new Date();
						const failureSpendLog = await buildSpendLogFromRequest({
							req: req,
							requestId: spendRequestId,
							auth: req.auth,
							callType: CallType.ACompletion,
							model: model,
							startTime: startTime,
							endTime: endTime,
							messages: originalMessages,
							proxyServerRequestBody: originalRequestBody,
							response: initialResult,
							usage: initialResult?.["usage"] as Record<string, unknown> | undefined,
							error: error,
							upstreamLogContext: getUpstreamLogContext(error),
							status: SpendLogStatus.Failure,
							modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
							routingTrace: copyRoutingTrace(modelResolutionTrace),
							attemptedRetries: modelResolutionTrace.fallbackDepth,
							maxRetries: litellmRouter.maxFallbacks,
							fallbackModels: [...modelResolutionTrace.fallbackModels],
						});
						try {
							await spendLifecycle.finalize(() => trackSpendLog(db, failureSpendLog).then(() => undefined));
						} catch (accountingError) {
							logger.error("Provider 失败后的花费账务提交失败", {
								accountingError: accountingError,
								requestId: spendRequestId,
							});
							if (spendRequestId) {
								await releaseSpend(db, spendRequestId).catch((releaseError: unknown) => {
									logger.error("Provider 失败后释放 reservation 失败", {
										error: releaseError,
										requestId: spendRequestId,
									});
								});
							}
						}
					}
					throw error;
				}
			}

			// === 流式响应 (SSE) ===
			await handleStreamingResponse(litellmRouter, model, messages, optionalParams, res, {
				req: req,
				db: db,
				spendRequestId: spendRequestId,
				spendLifecycle: spendLifecycle,
				modelResolutionTrace: modelResolutionTrace,
				originalMessages: originalMessages,
				originalRequestBody: originalRequestBody,
				visionImageStore: visionImageStore,
			});
			return undefined;
		} finally {
			req.removeListener("aborted", abortWebSearch);
			res.removeListener("close", abortWebSearch);
			spendLifecycle.stop();
		}
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
	context: {
		req: import("express").Request;
		db: DrizzleDb;
		spendRequestId?: string;
		spendLifecycle: EndpointSpendLifecycle;
		modelResolutionTrace: ModelResolutionTraceCollector;
		originalMessages: Message[];
		originalRequestBody: Record<string, unknown>;
		visionImageStore: VisionImageStore;
	},
): Promise<void> {
	const { req, db, spendRequestId, spendLifecycle, modelResolutionTrace, originalMessages, originalRequestBody, visionImageStore } =
		context;
	const preparedVision = await prepareOpenAIVisionRequest(
		litellmRouter,
		model,
		messages as unknown as Array<Record<string, unknown>>,
		visionImageStore,
	);
	const preparedImageGeneration = await prepareOpenAIImageGenerationRequest(
		litellmRouter,
		model,
		messages as unknown as Array<Record<string, unknown>>,
		visionImageStore,
	);
	const preparedWeb = await prepareOpenAIWebRequest(litellmRouter, model, messages as unknown as Array<Record<string, unknown>>);
	if (preparedVision || preparedImageGeneration || preparedWeb) {
		await handlePrivateVisionStreamingResponse(litellmRouter, model, messages, optionalParams, res, {
			...context,
			preparedWeb: preparedWeb,
		});
		return;
	}
	const includeStreamUsage = shouldIncludeStreamUsage(optionalParams);
	let fallbackDepth = 0;
	let currentModel = model;
	const fallbackModels: string[] = [model];
	let lastError: unknown;
	let lastUpstreamLogContext: UpstreamLogContext | undefined;
	const startTime = new Date();
	const upstreamAbortController = new AbortController();
	const abortUpstream = (): void => {
		// 正常写完响应后 close 也会触发；此时中止会把成功请求误记成 AbortError 失败。
		if (res.writableEnded || res.writableFinished) {
			return;
		}
		// 带上中止来源，失败 SpendLog 才能区分「客户端断开」与上游故障。
		upstreamAbortController.abort(new DOMException(`客户端在响应完成前断开连接（/v1/chat/completions）`, "AbortError"));
	};
	req.once("aborted", abortUpstream);
	res.once("close", abortUpstream);

	while (true) {
		const resolution = litellmRouter.resolveModelGroupWithTrace?.(currentModel) ?? {
			inputModel: currentModel,
			resolvedModel: currentModel,
			resolutionPath: [currentModel],
		};
		appendModelResolutionTrace(modelResolutionTrace, fallbackDepth, resolution);
		const candidate = litellmRouter.getAvailableDeployment(currentModel, messages, optionalParams);
		if (!candidate) {
			const nextFallback = getNextStreamingFallback(litellmRouter, currentModel, model, fallbackModels);
			if (!nextFallback) {
				break;
			}
			appendRoutingTrace(modelResolutionTrace, {
				fromModel: currentModel,
				toResolution: nextFallback,
				routingType: "general_fallback",
				reason: "no_available_deployment",
				error: Object.assign(new Error(`No available deployment for model "${resolution.resolvedModel}"`), {
					name: "NoAvailableDeploymentError",
					statusCode: 429,
				}),
			});
			fallbackDepth++;
			currentModel = nextFallback.inputModel;
			fallbackModels.push(nextFallback.resolvedModel);
			continue;
		}

		const { deployment, provider } = candidate;
		const providerReq = provider.transformRequest(
			deployment.litellm_params.model,
			messages,
			applyReasoningEffortOverride(
				{
					...deployment.litellm_params,
					...optionalParams,
					stream: true,
				},
				deployment,
				"chat",
			),
		);
		lastUpstreamLogContext = createUpstreamLogContext(providerReq);
		litellmRouter.trackActiveRequest(getDeploymentKey(deployment), 1);
		let stopKeepalive: () => void = () => undefined;

		try {
			stopKeepalive = await startSseKeepalive(req, res, deployment, "openai", SSE_KEEPALIVE_INTERVAL_MS / 1000);
			const timeoutSec = deployment.litellm_params.stream_timeout ?? deployment.litellm_params.timeout;
			const execution = await executeProviderRequest(providerReq, {
				readJson: false,
				signal: upstreamAbortController.signal,
				timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
			});
			const response = execution.response;
			lastUpstreamLogContext = createUpstreamLogContext(providerReq, response);
			if (!response.ok) {
				// executor 在 readJson:false 且非 2xx 时已消费响应体并写入 execution.body；
				// 再调 response.json() 只会得到 "Body has already been read" → {}，上游错误全丢。
				const errorBody = execution.body === undefined ? {} : execution.body;
				lastUpstreamLogContext = createUpstreamLogContext(providerReq, response, errorBody);
				throw attachUpstreamLogContext(
					new ApiError(
						response.status,
						`Provider 返回错误: ${redactConfiguredSecrets(describeUpstreamErrorBody(errorBody), { ...deployment.litellm_params, ...providerReq.headers })}`,
					),
					lastUpstreamLogContext,
				);
			}

			const spendInfo = buildDeploymentSpendInfo(deployment, providerReq.url);
			if (!provider.supportsStreaming() || !response.body) {
				const rawBody = await response.json();
				const transformed = provider.transformResponse(deployment.litellm_params.model, rawBody);
				lastUpstreamLogContext = createUpstreamLogContext(providerReq, response, rawBody);
				const completionStartTime = new Date();
				if (fallbackDepth === 0) {
					transformed.model = model;
				}
				calculateAndSetCost(transformed, model, spendInfo.customCostPerToken);
				if (req.auth) {
					const spendLog = await buildSpendLogFromRequest({
						req: req,
						requestId: spendRequestId,
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
						messages: originalMessages,
						proxyServerRequestBody: originalRequestBody,
						response: transformed,
						upstreamLogContext: lastUpstreamLogContext,
						usage: transformed.usage as unknown as Record<string, unknown> | undefined,
						status: SpendLogStatus.Success,
						attemptedRetries: fallbackDepth,
						fallbackModels: fallbackModels,
						modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
						routingTrace: copyRoutingTrace(modelResolutionTrace),
					});
					await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
				}
				res.json(stripInternalFields(transformed));
				return;
			}

			if (!res.headersSent) {
				res.setHeader("Content-Type", "text/event-stream");
				res.setHeader("Cache-Control", "no-cache");
				res.setHeader("Connection", "keep-alive");
				res.setHeader("X-Accel-Buffering", "no");
				const providerHeaders = (response as unknown as { _providerHeaders?: Record<string, string> })._providerHeaders;
				for (const [key, value] of Object.entries(providerHeaders ?? {})) {
					if (isForwardableUpstreamHeader(key) && !res.getHeader(key)) {
						res.setHeader(key, value);
					}
				}
			}

			let clientDisconnected = false;
			res.on("close", () => {
				if (!res.writableEnded) {
					clientDisconnected = true;
				}
			});
			const accumulator: ChatStreamAccumulator = { choices: new Map(), estimatedCompletionTokens: 0 };
			const checkpointRequestId = spendRequestId;
			let streamingCheckpointScheduler: StreamingCheckpointScheduler<StreamingCheckpoint> | undefined;
			if (checkpointRequestId !== undefined) {
				streamingCheckpointScheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
					serialize: () => {
						const response = buildAggregatedChatResponse(accumulator, fallbackDepth === 0 ? model : currentModel);
						const usage =
							accumulator.usage ??
							(accumulator.estimatedCompletionTokens > 0
								? {
										prompt_tokens: 0,
										completion_tokens: accumulator.estimatedCompletionTokens,
										total_tokens: accumulator.estimatedCompletionTokens,
									}
								: undefined);
						if (response === undefined && usage === undefined) {
							return null;
						}
						return {
							protocol: "chat_completions",
							state: "in_progress",
							response: (response ?? null) as Record<string, unknown> | null,
							usage: (usage ?? null) as Record<string, unknown> | null,
							upstream_request: (lastUpstreamLogContext?.request ?? null) as Record<string, unknown> | null,
							upstream_response: (lastUpstreamLogContext?.response ?? null) as Record<string, unknown> | null,
						};
					},
					write: (checkpoint) => checkpointActiveRequest(db, checkpointRequestId, checkpoint, "streaming_execution"),
				});
			}
			let streamError: unknown;
			let completionStartTime: Date | undefined;
			let usageChunkSent = false;
			let semanticOutputEmitted = false;
			let retryBeforeOutput = false;

			try {
				const stream = (provider as unknown as StreamingProvider).streamResponse(response);
				for await (const chunk of stream) {
					if ("error" in chunk) {
						throw new Error(redactConfiguredSecrets(JSON.stringify(chunk["error"]), deployment.litellm_params));
					}
					semanticOutputEmitted = true;
					if (fallbackDepth === 0) {
						chunk.model = model;
					}
					if (!completionStartTime) {
						completionStartTime = new Date();
						litellmRouter.recordDeploymentTtft?.(deployment, Date.now() - execution.startedAtMs);
					}
					accumulateChatChunk(accumulator, chunk);
					streamingCheckpointScheduler?.onChunk();
					if (!clientDisconnected) {
						const strippedChunk = stripInternalFields(chunk) as Record<string, unknown>;
						const choices = Array.isArray(strippedChunk["choices"]) ? strippedChunk["choices"] : [];
						const chunkUsage = strippedChunk["usage"];
						// Provider 可为内部计费请求用量；客户端仍按原始 include_usage 选项接收。
						if (!includeStreamUsage) {
							delete strippedChunk["usage"];
						}
						if (!includeStreamUsage && chunkUsage !== undefined && choices.length === 0) {
							continue;
						}
						const publicChunk =
							includeStreamUsage && chunkUsage === undefined
								? { ...strippedChunk, usage: null }
								: includeStreamUsage && chunkUsage && typeof chunkUsage === "object"
									? { ...strippedChunk, usage: toOpenAIUsage(chunkUsage as Usage) }
									: strippedChunk;
						usageChunkSent ||= choices.length === 0 && publicChunk["usage"] !== null && publicChunk["usage"] !== undefined;
						res.write(`data: ${JSON.stringify(publicChunk)}\n\n`);
					}
				}
				if (!clientDisconnected) {
					if (includeStreamUsage && !usageChunkSent && accumulator.usage) {
						res.write(
							`data: ${JSON.stringify({
								id: accumulator.id ?? "",
								object: "chat.completion.chunk",
								created: accumulator.created ?? Math.floor(Date.now() / 1000),
								model: accumulator.model ?? (fallbackDepth === 0 ? model : currentModel),
								choices: [],
								usage: toOpenAIUsage(accumulator.usage),
							})}\n\n`,
						);
					}
					res.write("data: [DONE]\n\n");
				}
			} catch (err) {
				const streamFailure = err instanceof Error ? err : new Error(String(err));
				streamFailure.message = redactConfiguredSecrets(streamFailure.message, {
					...deployment.litellm_params,
					...providerReq.headers,
				});
				streamError = streamFailure;
				retryBeforeOutput =
					!semanticOutputEmitted &&
					!clientDisconnected &&
					!upstreamAbortController.signal.aborted &&
					getNextStreamingFallback(litellmRouter, currentModel, model, fallbackModels) !== null;
				if (!retryBeforeOutput && !clientDisconnected) {
					litellmRouter.recordDeploymentFailure?.(deployment, streamFailure);
				}
				logger.error("流式响应处理异常", { error: streamFailure });
				if (!retryBeforeOutput && !clientDisconnected) {
					res.write(`data: ${JSON.stringify({ error: { message: String(streamFailure), type: "stream_error" } })}\n\n`);
				}
			} finally {
				stopKeepalive();
				await streamingCheckpointScheduler?.dispose();
				if (!retryBeforeOutput) {
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
						const spendLog = await buildSpendLogFromRequest({
							req: req,
							requestId: spendRequestId,
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
							messages: originalMessages,
							proxyServerRequestBody: originalRequestBody,
							response: responseForLog,
							upstreamLogContext: lastUpstreamLogContext,
							usage: usage as unknown as Record<string, unknown> | undefined,
							error: streamError,
							status: streamError === undefined ? SpendLogStatus.Success : SpendLogStatus.Failure,
							attemptedRetries: fallbackDepth,
							fallbackModels: fallbackModels,
							modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
							routingTrace: copyRoutingTrace(modelResolutionTrace),
						});
						try {
							await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
						} catch (accountingError) {
							// SSE headers 已发送，无法再返回 503；保留错误日志供运维重试账务。
							logger.error("流式花费账务提交失败", { error: accountingError, requestId: spendRequestId });
							const failedRequestId = streamError !== undefined ? spendRequestId : undefined;
							await (failedRequestId ? releaseSpend(db, failedRequestId) : Promise.resolve()).catch(
								(releaseError: unknown) => {
									logger.error("流式 Provider 失败后释放 reservation 失败", {
										error: releaseError,
										requestId: spendRequestId,
									});
								},
							);
						}
					}
				}
			}
			if (retryBeforeOutput) {
				throw streamError;
			}
			return;
		} catch (err) {
			if (err !== null && typeof err === "object" && "name" in err && err.name === "AbortError") {
				throw err;
			}
			if (spendLifecycle.isFinalized()) {
				throw err;
			}
			if (getUpstreamLogContext(err) === undefined && err !== null && typeof err === "object") {
				attachUpstreamLogContext(err as object, lastUpstreamLogContext);
			}
			lastError = err;
			if (litellmRouter.recordDeploymentFailure) {
				litellmRouter.recordDeploymentFailure(deployment, err instanceof Error ? err : new Error(String(err)));
			} else {
				litellmRouter.markFailed(getDeploymentKey(deployment));
			}
			const nextFallback = getNextStreamingFallback(litellmRouter, currentModel, model, fallbackModels);
			if (!nextFallback) {
				break;
			}
			appendRoutingTrace(modelResolutionTrace, {
				fromModel: currentModel,
				toResolution: nextFallback,
				routingType: "general_fallback",
				error: err instanceof Error ? err : new Error(String(err)),
				attemptedDeployment: deployment.model_name,
			});
			fallbackDepth++;
			currentModel = nextFallback.inputModel;
			fallbackModels.push(nextFallback.resolvedModel);
		} finally {
			stopKeepalive();
			litellmRouter.trackActiveRequest(getDeploymentKey(deployment), -1);
		}
	}

	// 所有部署和 fallback 均失败；lastError 存在说明打到过 provider（透传其错误）。
	// 无 lastError 说明连候选部署都没有，按模型存在性分流（对齐 PY route_llm_request
	// 校验层与非流式 RouterExecution 的 hasModel 判定）：
	// 模型不存在 → 400 ProxyModelNotFoundError；模型存在但全部署冷却 → 429 no-deployments。
	const terminalError =
		lastError ??
		(!litellmRouter.hasModel(model)
			? buildInvalidModelError(formatInvalidModelMessage(CHAT_COMPLETIONS_ROUTE_NAME, model))
			: ApiError.noDeploymentsAvailable(model, litellmRouter.getNoAvailableDeploymentInfo(model)));
	if (req.auth && spendRequestId) {
		try {
			await spendLifecycle.finalize(async () =>
				trackSpendLog(
					db,
					await buildSpendLogFromRequest({
						req: req,
						auth: req.auth,
						requestId: spendRequestId,
						callType: CallType.ACompletion,
						model: model,
						modelGroup: model,
						startTime: startTime,
						endTime: new Date(),
						messages: originalMessages,
						proxyServerRequestBody: originalRequestBody,
						error: terminalError,
						upstreamLogContext: getUpstreamLogContext(terminalError) ?? lastUpstreamLogContext,
						status: SpendLogStatus.Failure,
						attemptedRetries: modelResolutionTrace.fallbackDepth,
						maxRetries: litellmRouter.maxFallbacks,
						fallbackModels: [...modelResolutionTrace.fallbackModels],
						modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
						routingTrace: copyRoutingTrace(modelResolutionTrace),
					}),
				).then(() => undefined),
			);
		} catch (accountingError) {
			logger.error("所有 fallback 失败后的花费账务提交失败", {
				accountingError: accountingError,
				requestId: spendRequestId,
			});
			try {
				await releaseSpend(db, spendRequestId);
			} catch (releaseError) {
				logger.error("所有 fallback 失败后释放 reservation 失败", { error: releaseError, requestId: spendRequestId });
			}
		}
	}
	throw terminalError;
}

/**
 * Runs the hidden multi-turn vision loop before exposing any bytes, then emits
 * one protocol-valid public Chat Completions stream. Internal tool calls can
 * therefore never leak even when the client requested streaming.
 * @param litellmRouter
 * @param model
 * @param messages
 * @param optionalParams
 * @param res
 * @param context
 */
async function handlePrivateVisionStreamingResponse(
	litellmRouter: LiteLLMRouter,
	model: string,
	messages: Message[],
	optionalParams: Record<string, unknown>,
	res: import("express").Response,
	context: {
		req: import("express").Request;
		db: DrizzleDb;
		spendRequestId?: string;
		spendLifecycle: EndpointSpendLifecycle;
		modelResolutionTrace: ModelResolutionTraceCollector;
		originalMessages: Message[];
		originalRequestBody: Record<string, unknown>;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>>;
	},
): Promise<void> {
	const {
		req,
		db,
		spendRequestId,
		spendLifecycle,
		modelResolutionTrace,
		originalMessages,
		originalRequestBody,
		visionImageStore,
		preparedWeb,
	} = context;
	const startTime = new Date();
	const visionAudit = createVisionCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });
	const webAudit = createWebCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });
	const imageGenerationAudit = createImageGenerationCapabilityAuditHook({ db: db, req: req, parentRequestId: spendRequestId });
	// capability agent loop 每轮的主模型调用改为向上游请求流式（即使 agent loop 内部强制
	// stream:false 也要流式），边累积边 checkpoint，使「进行中」时能看到主模型的流式中间响应；
	// complete 回调在流结束后返回累积的完整响应供 agent loop 决策（解析 tool_use）。
	let currentAccumulator: ChatStreamAccumulator | undefined;
	let chatSseStarted = false;
	// capability 分支向上游请求流式后，从 streamResult 提取上游上下文供 checkpoint 记录
	let currentUpstreamLogContext: UpstreamLogContext | undefined;
	const checkpointRequestId = spendRequestId;
	let streamingCheckpointScheduler: StreamingCheckpointScheduler<StreamingCheckpoint> | undefined;
	if (checkpointRequestId !== undefined && db !== undefined) {
		streamingCheckpointScheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
			serialize: () => {
				const acc = currentAccumulator;
				if (!acc) {
					return null;
				}
				const response = buildAggregatedChatResponse(acc, model);
				const usage =
					acc.usage ??
					(acc.estimatedCompletionTokens > 0
						? {
								prompt_tokens: 0,
								completion_tokens: acc.estimatedCompletionTokens,
								total_tokens: acc.estimatedCompletionTokens,
							}
						: undefined);
				if (response === undefined && usage === undefined) {
					return null;
				}
				return {
					protocol: "chat_completions",
					state: "in_progress",
					response: (response ?? null) as Record<string, unknown> | null,
					usage: (usage ?? null) as Record<string, unknown> | null,
					upstream_request: (currentUpstreamLogContext?.request ?? null) as Record<string, unknown> | null,
					upstream_response: (currentUpstreamLogContext?.response ?? null) as Record<string, unknown> | null,
				};
			},
			write: (checkpoint) => checkpointActiveRequest(db, checkpointRequestId, checkpoint, "streaming_execution"),
		});
	}

	const result = await runOpenAIBuiltinCapabilityAgentLoop(
		litellmRouter,
		model,
		messages as unknown as Array<Record<string, unknown>>,
		optionalParams,
		async (completionModel, completionMessages, params) => {
			const streamResult = await litellmRouter.completion(
				completionModel,
				completionMessages,
				{ ...params, stream: true },
				modelResolutionTrace,
			);
			const stream = (streamResult as { stream?: AsyncGenerator<ModelResponseStream> })["stream"];
			if (stream === undefined) {
				return streamResult;
			}
			const accumulator: ChatStreamAccumulator = { choices: new Map(), estimatedCompletionTokens: 0 };
			currentAccumulator = accumulator;
			currentUpstreamLogContext = getUpstreamLogContext(streamResult);
			for await (const chunk of stream) {
				if (chunk && typeof chunk === "object") {
					const choices = (chunk as unknown as Record<string, unknown>)["choices"];
					if (Array.isArray(choices)) {
						for (const item of choices) {
							const delta = (item as Record<string, unknown>)["delta"] as Record<string, unknown> | undefined;
							if (delta === undefined) {
								continue;
							}
							const visible: Record<string, unknown> = {};
							if (typeof delta["content"] === "string" && delta["content"].length > 0) {
								visible["content"] = delta["content"];
							}
							if (typeof delta["reasoning_content"] === "string" && delta["reasoning_content"].length > 0) {
								visible["reasoning_content"] = delta["reasoning_content"];
							}
							if (Object.keys(visible).length === 0) {
								continue;
							}
							const head = {
								id: (chunk as unknown as Record<string, unknown>)["id"],
								object: "chat.completion.chunk",
								created: (chunk as unknown as Record<string, unknown>)["created"],
								model: (chunk as unknown as Record<string, unknown>)["model"],
							};
							if (!chatSseStarted) {
								chatSseStarted = true;
								if (!res.headersSent) {
									res.setHeader("Content-Type", "text/event-stream");
									res.setHeader("Cache-Control", "no-cache");
									res.setHeader("Connection", "keep-alive");
									res.setHeader("X-Accel-Buffering", "no");
								}
								res.write(`data: ${JSON.stringify({ ...head, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
							}
							res.write(`data: ${JSON.stringify({ ...head, choices: [{ index: 0, delta: visible, finish_reason: null }] })}\n\n`);
						}
					}
					accumulateChatChunk(accumulator, chunk as ModelResponseStream);
					streamingCheckpointScheduler?.onChunk();
				}
			}
			return finalizeStreamedCompletion(accumulator, completionModel, streamResult);
		},
		{
			visionAudit: visionAudit,
			imageGenerationAudit: imageGenerationAudit,
			webAudit: webAudit,
			visionImageStore: visionImageStore,
			preparedWeb: preparedWeb,
		},
	);
	await streamingCheckpointScheduler?.dispose();
	const completionStartTime = new Date();
	const spendInfo = (result as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
	calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
	if (result["_fallbackDepth"] === 0) {
		result["model"] = model;
	}
	const response = result as unknown as ModelResponse;
	const choice = response.choices?.[0];
	if (!choice) {
		throw ApiError.unavailable("识图 Agent Loop 没有返回 completion choice");
	}
	const usage = response.usage;
	if (!res.headersSent) {
		const providerHeaders = (result as { _providerHeaders?: Record<string, string> })._providerHeaders;
		for (const [key, value] of Object.entries(providerHeaders ?? {})) {
			if (isForwardableUpstreamHeader(key) && !res.getHeader(key)) {
				res.setHeader(key, value);
			}
		}
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");
	}
	const id = response.id;
	const created = response.created;
	const publicModel = response.model || model;
	const base = { id: id, object: "chat.completion.chunk", created: created, model: publicModel };
	if (!chatSseStarted) {
	res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
	}
	const delta: Record<string, unknown> = {};
	if (typeof choice.message.content === "string" && choice.message.content.length > 0) {
		delta["content"] = choice.message.content;
	}
	if (choice.message.reasoning_content) {
		delta["reasoning_content"] = choice.message.reasoning_content;
	}
	if (choice.message.tool_calls?.length) {
		delta["tool_calls"] = choice.message.tool_calls.map((call, index) => ({
			index: index,
			id: call.id,
			type: "function",
			function: { name: call.function.name, arguments: call.function.arguments },
		}));
	}
	const generatedMessage = choice.message as unknown as Record<string, unknown>;
	if (generatedMessage["image"] !== undefined) {
		delta["image"] = generatedMessage["image"];
	}
	if (generatedMessage["images"] !== undefined) {
		delta["images"] = generatedMessage["images"];
	}
	if (!chatSseStarted && Object.keys(delta).length > 0) {
		res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: delta, finish_reason: null }] })}\n\n`);
	}
	res.write(
		`data: ${JSON.stringify({
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
			...(shouldIncludeStreamUsage(optionalParams) ? { usage: null } : {}),
		})}\n\n`,
	);
	if (shouldIncludeStreamUsage(optionalParams) && usage) {
		res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: toOpenAIUsage(usage) })}\n\n`);
	}
	res.write("data: [DONE]\n\n");
	res.end();

	if (req.auth) {
		const metadata = getResultModelResolutionMetadata(result);
		const spendLog = await buildSpendLogFromRequest({
			req: req,
			requestId: spendRequestId,
			auth: req.auth,
			callType: CallType.ACompletion,
			model: model,
			modelGroup: model,
			modelId: spendInfo?.modelId,
			customLlmProvider: spendInfo?.customLlmProvider,
			apiBase: spendInfo?.apiBase,
			customCostPerToken: spendInfo?.customCostPerToken,
			deploymentModel: spendInfo?.deploymentModel,
			startTime: startTime,
			endTime: new Date(),
			completionStartTime: completionStartTime,
			messages: originalMessages,
			proxyServerRequestBody: originalRequestBody,
			response: result,
			upstreamLogContext: getUpstreamLogContext(result),
			usage: usage as unknown as Record<string, unknown> | undefined,
			status: SpendLogStatus.Success,
			attemptedRetries: metadata.attemptedRetries,
			fallbackModels: metadata.fallbackModels,
			modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
			routingTrace: metadata.routingTrace ?? copyRoutingTrace(modelResolutionTrace),
		});
		await spendLifecycle.finalize(() => trackSpendLog(db, spendLog).then(() => undefined));
	}
}
