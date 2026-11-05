import { toChatUsage } from "../core/utils/usage";
import { startSseKeepalive, getKeepaliveDeployment } from "./SseKeepalive";
import { countInputTokens } from "../core/utils/inputTokens";
import { canAuthAccessModel } from "../auth/AuthChecks";
import { resolveCodingClientModel } from "./CodingClientModels";
/**
 * Responses API 端点。
 *
 * POST create 委托统一 Router/fallback；retrieve/delete 依赖持久化存储，当前显式返回 501。
 */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Request, Response, Router } from "express";
import { runCommonChecks } from "../auth/AuthChecks";
import { ApiError } from "../core/api/ApiError";
import { isForwardableUpstreamHeader } from "../core/api/upstreamHeaders";
import { registerRoute } from "../core/api/registerRoute";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import { ROUTER_CALL_TYPE_PARAM, ROUTER_RESPONSES_BODY_PARAM, type Router as LiteLLMRouter } from "../router/Router";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { getResultModelResolutionMetadata } from "../router/ModelResolutionTrace";
import { createEndpointSpendLifecycle, reserveEndpointSpend, type EndpointSpendLifecycle } from "../spend/SpendReservation";
import {
	buildSpendLogFromRequest,
	calculateAndSetCost,
	checkpointActiveRequest,
	injectResponseCostHeader,
	releaseSpend,
	trackSpendLog,
} from "../spend/SpendTracker";
import { StreamingCheckpointScheduler } from "../spend/StreamingCheckpointScheduler";
import type { StreamingCheckpoint } from "../spend/StreamingCheckpointScheduler";
import type { Message, ModelResponse, ModelResponseStream, ThinkingBlock, ToolCall, Usage } from "../types/openai";
import { CallType, SpendLogStatus } from "../types/spend";
import { prepareOpenAIVisionRequest } from "../capabilities/VisionCapability";
import {
	createImageGenerationCapabilityAuditHook,
	createVisionCapabilityAuditHook,
	createWebCapabilityAuditHook,
} from "../capabilities/BuiltinCapabilityAudit";
import { prepareOpenAIImageGenerationRequest, type BuiltinGeneratedImage } from "../capabilities/ImageGenerationCapability";
import { createVisionImageStore, type VisionImageStore } from "../capabilities/VisionImageStore";
import { runOpenAIBuiltinCapabilityAgentLoop } from "../capabilities/BuiltinCapabilityRunner";
import { prepareOpenAIWebRequest } from "../capabilities/WebCapability";
import { getUpstreamLogContext, type UpstreamLogContext } from "../router/UpstreamLogContext";
import { reasoningTextFromBlock } from "../core/utils/contentFields";
import { accumulateChatChunk, finalizeStreamedCompletion, type ChatStreamAccumulator } from "./ChatCompletionsEndpoint";

const logger = createModuleLogger("Proxy:Responses");

type ResponsesContentPart =
	| { type: "input_text" | "output_text" | "text"; text: string }
	| { type: "input_image"; image_url?: string; file_id?: string; detail?: string }
	| Record<string, unknown>;

interface ResponsesMessageItem {
	type?: "message";
	role: string;
	content: string | ResponsesContentPart[];
}

interface ResponsesFunctionCallItem {
	type: "function_call";
	call_id?: string;
	id?: string;
	name: string;
	namespace?: string;
	arguments: string;
}

interface ResponsesFunctionCallOutputItem {
	type: "function_call_output";
	call_id: string;
	output: unknown;
}

interface ResponsesReasoningItem {
	type: "reasoning";
	[key: string]: unknown;
}

type ResponsesInputItem =
	| ResponsesMessageItem
	| ResponsesFunctionCallItem
	| ResponsesFunctionCallOutputItem
	| ResponsesReasoningItem
	| Record<string, unknown>;

interface ResponsesFunctionTool {
	type: "function";
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
	strict?: boolean;
}

interface ResponsesNamespaceTool {
	type: "namespace";
	name: string;
	description?: string;
	tools: ResponsesFunctionTool[];
}

type ResponsesTool = ResponsesFunctionTool | ResponsesNamespaceTool | Record<string, unknown>;

interface ResponsesCreateRequest {
	model?: string;
	input?: string | ResponsesInputItem[];
	instructions?: string;
	tools?: ResponsesTool[];
	stream?: boolean;
	[key: string]: unknown;
}

interface ResponsesToolName {
	name: string;
	namespace?: string;
}

interface ResponsesToolRegistry {
	chatTools: Record<string, unknown>[];
	responsesTools: Record<string, unknown>[];
	toChatName(name: string, namespace?: string): string;
	fromChatName(name: string): ResponsesToolName;
}

interface ChatMessage {
	role: string;
	content: unknown;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

interface ResponseUsage {
	input_tokens: number;
	input_tokens_details: { cached_tokens: number };
	output_tokens: number;
	output_tokens_details: { reasoning_tokens: number };
	total_tokens: number;
}

interface ResponseError {
	code: string;
	message: string;
}

interface ResponseOutputItem extends Record<string, unknown> {
	id: string;
	type: "reasoning" | "message" | "function_call" | "image_generation_call";
}

interface StandardResponseObject extends Record<string, unknown> {
	id: string;
	object: "response";
	created_at: number;
	completed_at: number | null;
	status: "in_progress" | "completed" | "incomplete" | "failed";
	error: ResponseError | null;
	incomplete_details: Record<string, unknown> | null;
	instructions: string | null;
	model: string;
	output: ResponseOutputItem[];
	usage: ResponseUsage | null;
}

interface StreamToolState {
	id: string;
	name: string;
	arguments: string;
	itemId: string;
	outputIndex: number;
}

interface ResponsesStreamState {
	responseId: string;
	createdAt: number;
	model: string;
	instructions: string | null;
	output: ResponseOutputItem[];
	messageItem?: ResponseOutputItem;
	reasoningItem?: ResponseOutputItem;
	tools: Map<number, StreamToolState>;
	text: string;
	refusal: string;
	reasoning: string;
	nextContentIndex: number;
	textContentIndex?: number;
	refusalContentIndex?: number;
	usage?: Usage;
	finishReason?: string;
	sequence: number;
	terminalSent: boolean;
	toolRegistry: ResponsesToolRegistry;
}

interface ResponsesStreamContext {
	litellmRouter: LiteLLMRouter;
	model: string;
	messages: ChatMessage[];
	optionalParams: Record<string, unknown>;
	requestBody: ResponsesCreateRequest;
	req: Request;
	res: Response;
	db: DrizzleDb | undefined;
	requestId: string | undefined;
	startTime: Date;
	lifecycle: EndpointSpendLifecycle;
	visionImageStore: VisionImageStore;
	toolRegistry: ResponsesToolRegistry;
}

/**
 * 注册 Responses API 路由。
 * @param router
 * @param litellmRouter
 * @param db
 */
export function registerResponsesApiRoutes(router: Router, litellmRouter?: LiteLLMRouter, db?: DrizzleDb): void {
	const createHandler = createResponsesHandler(litellmRouter, db);
	for (const path of ["/v1/responses/input_tokens", "/responses/input_tokens", "/openai/v1/responses/input_tokens"]) {
		registerRoute(router, { method: "post", path: path }, (req) => {
			const body = req.body as ResponsesCreateRequest;
			if (!body?.model || typeof body.model !== "string") {
				throw ApiError.badRequest("Missing required parameter: 'model'.");
			}
			if (body.input === undefined || body.input === "" || (Array.isArray(body.input) && body.input.length === 0)) {
				throw ApiError.badRequest("Missing required parameter: 'input'.");
			}
			if (body.previous_response_id || body["conversation"] || body["prompt"]) {
				throw ApiError.badRequest("Stored Responses context is not supported for token counting.");
			}
			if (req.auth && !canAuthAccessModel(req.auth, body.model)) {
				throw ApiError.forbidden("API key cannot access this model");
			}
			const registry = buildResponsesToolRegistry(body.tools);
			const messages = buildResponsesMessages(body.input, body.instructions, registry);
			return { object: "response.input_tokens", input_tokens: countInputTokens(messages, registry.chatTools) };
		});
	}
	registerRoute(router, { method: "post", path: "/cursor/chat/completions" }, async (req, res) => {
		if (req.body && "input" in req.body) {
			if (litellmRouter) {
				req.body = resolveCodingClientModel(req.body, litellmRouter, true);
			}
			return createHandler(req, res);
		}
		throw ApiError.badRequest("Cursor request must include input or messages");
	});
	registerRoute(router, { method: "post", path: "/v1/responses" }, createHandler);
	registerRoute(router, { method: "post", path: "/responses" }, createHandler);
	registerRoute(router, { method: "get", path: "/v1/responses/:id" }, responseStorageNotImplemented);
	registerRoute(router, { method: "get", path: "/responses/:id" }, responseStorageNotImplemented);
	registerRoute(router, { method: "delete", path: "/v1/responses/:id" }, responseStorageNotImplemented);
	registerRoute(router, { method: "delete", path: "/responses/:id" }, responseStorageNotImplemented);
}

function createResponsesHandler(litellmRouter: LiteLLMRouter | undefined, db: DrizzleDb | undefined) {
	return async (req: Request, res: Response): Promise<Record<string, unknown> | undefined> => {
		if (!litellmRouter) {
			throw ApiError.unavailable("Responses 创建暂未实现");
		}
		const reqBody = req.body as ResponsesCreateRequest;
		const model = reqBody.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		if (reqBody.input === undefined) {
			throw ApiError.badRequest("input 字段缺失");
		}
		validateResponsesPersistenceOptions(reqBody);
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}

		const toolRegistry = buildResponsesToolRegistry(reqBody.tools);
		const messages = buildResponsesMessages(reqBody.input, reqBody.instructions, toolRegistry);
		const optionalParams = buildResponsesOptionalParams(reqBody, toolRegistry);
		optionalParams[ROUTER_CALL_TYPE_PARAM] = "responses";
		// 原生 Responses 请求体总是随参数下发：支持原生 Responses 的 provider（含 CLIProxy）
		// 会原样转发，客户端与上游之间不再因为兼容端点优先而降级成 chat——降级会丢掉
		// reasoning 增量，并把工具参数合并成单个块；不支持原生 Responses 的 provider 由
		// 路由层回落到 chat。
		optionalParams[ROUTER_RESPONSES_BODY_PARAM] = buildNativeResponsesRequestBody(reqBody, toolRegistry);
		const startTime = new Date();
		const reservation = await reserveEndpointSpend(db, litellmRouter, req, model, reqBody, {
			callType: CallType.AResponses,
			startTime: startTime,
		});
		const lifecycle = createEndpointSpendLifecycle(reservation);
		const requestId = reservation?.requestId;
		const visionAudit = createVisionCapabilityAuditHook({ db: db, req: req, parentRequestId: requestId });
		const imageGenerationAudit = createImageGenerationCapabilityAuditHook({ db: db, req: req, parentRequestId: requestId });
		const webAudit = createWebCapabilityAuditHook({ db: db, req: req, parentRequestId: requestId });
		const visionImageStore = createVisionImageStore(db);
		lifecycle.markProviderStarted();

		try {
			if (reqBody.stream === true) {
				await handleResponsesStream({
					litellmRouter: litellmRouter,
					model: model,
					messages: messages,
					optionalParams: optionalParams,
					requestBody: reqBody,
					req: req,
					res: res,
					db: db,
					requestId: requestId,
					startTime: startTime,
					lifecycle: lifecycle,
					visionImageStore: visionImageStore,
					toolRegistry: toolRegistry,
				});
				return undefined;
			}

			let providerCompleted = false;
			try {
				const nativeResponses = litellmRouter.supportsNativeResponses?.(model) ?? false;
				const capabilityMessages = messages as unknown as Array<Record<string, unknown>>;
				const preparedVision = await prepareOpenAIVisionRequest(litellmRouter, model, capabilityMessages, visionImageStore);
				const preparedImageGeneration = await prepareOpenAIImageGenerationRequest(
					litellmRouter,
					model,
					capabilityMessages,
					visionImageStore,
				);
				const preparedWeb = await prepareOpenAIWebRequest(litellmRouter, model, capabilityMessages);
				const result =
					preparedVision || preparedImageGeneration || preparedWeb
						? await runOpenAIBuiltinCapabilityAgentLoop(
								litellmRouter,
								model,
								capabilityMessages,
								optionalParams,
								nativeResponses
									? createNativeResponsesCapabilityCompletion(litellmRouter, reqBody, capabilityMessages, toolRegistry)
									: undefined,
								{
									visionAudit: visionAudit,
									imageGenerationAudit: imageGenerationAudit,
									webAudit: webAudit,
									visionImageStore: visionImageStore,
									preparedVision: preparedWeb ? undefined : preparedVision,
									preparedWeb: preparedWeb,
								},
							)
						: await litellmRouter.completion(model, messages as never, optionalParams);
				providerCompleted = true;
				const responseReceivedAt = new Date();
				const spendInfo = (result as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
				calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
				const usage = result["usage"] as Record<string, unknown> | undefined;
				const isNativeResponses = result["_responseProtocol"] === "responses";
				const response = isNativeResponses
					? buildNativeResponsesClientObject(result, reqBody, toolRegistry)
					: mapChatCompletionToResponse(result, reqBody, toolRegistry);
				if (usage?.["cost"] !== undefined) {
					injectResponseCostHeader(res, usage["cost"] as number);
				}
				copyProviderHeaders(result, res);
				const responseFailed = response["status"] === "failed";
				await lifecycle.finalize(() =>
					recordSpend(db, req, requestId, {
						model: model,
						requestBody: reqBody,
						startTime: startTime,
						completionStartTime: responseReceivedAt,
						response: response,
						usage: usage,
						spendInfo: spendInfo,
						upstreamLogContext: getUpstreamLogContext(result),
						status: responseFailed ? SpendLogStatus.Failure : SpendLogStatus.Success,
						...getResultModelResolutionMetadata(result),
					}),
				);
				return response;
			} catch (error) {
				if (providerCompleted) {
					throw error;
				}
				await lifecycle.finalize(() =>
					recordSpend(db, req, requestId, {
						model: model,
						requestBody: reqBody,
						startTime: startTime,
						error: error,
						upstreamLogContext: getUpstreamLogContext(error),
						status: SpendLogStatus.Failure,
						...getResultModelResolutionMetadata(error as unknown as Record<string, unknown>),
					}),
				);
				throw error;
			}
		} finally {
			lifecycle.stop();
		}
	};
}

function validateResponsesPersistenceOptions(body: ResponsesCreateRequest): void {
	if (body["background"] === true) {
		throw new ApiError(501, "Responses background mode 尚未实现", "not_implemented");
	}
	if (body["store"] === true) {
		throw new ApiError(501, "Responses 持久化尚未实现；请设置 store=false", "not_implemented");
	}
	if (body["previous_response_id"] !== undefined && body["previous_response_id"] !== null) {
		throw new ApiError(501, "previous_response_id 依赖 Responses 持久化，当前尚未实现", "not_implemented");
	}
	if (body["conversation"] !== undefined && body["conversation"] !== null) {
		throw new ApiError(501, "Responses conversation 状态尚未实现", "not_implemented");
	}
}

function buildResponsesMessages(
	input: string | ResponsesInputItem[],
	instructions: string | undefined,
	toolRegistry: ResponsesToolRegistry,
): ChatMessage[] {
	const messages: ChatMessage[] = [];
	if (instructions) {
		messages.push({ role: "developer", content: instructions });
	}
	if (typeof input === "string") {
		messages.push({ role: "user", content: input });
		return messages;
	}
	if (!Array.isArray(input)) {
		throw ApiError.badRequest("input 必须是字符串或 item 数组");
	}
	for (const item of input) {
		if (!item || typeof item !== "object") {
			throw ApiError.badRequest("input item 格式无效");
		}
		if (item.type === "reasoning") {
			// Native Responses requests retain the original item in the separately
			// preserved request body. Chat-compatible protocols cannot safely replay
			// encrypted or provider-specific reasoning, so omit it while retaining the
			// adjacent assistant message or function call that carries conversation state.
			continue;
		}
		if (item.type === "function_call_output") {
			const output = item as ResponsesFunctionCallOutputItem;
			messages.push({ role: "tool", tool_call_id: output.call_id, content: responseContentToChatContent(output.output) });
			continue;
		}
		if (item.type === "function_call") {
			const call = item as ResponsesFunctionCallItem;
			appendResponsesChatMessage(messages, {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: call.call_id ?? call.id ?? `call_${randomUUID()}`,
						type: "function",
						function: { name: toolRegistry.toChatName(call.name, call.namespace), arguments: call.arguments },
					},
				],
			});
			continue;
		}
		if (item.type === "input_text" && typeof item["text"] === "string") {
			messages.push({ role: "user", content: item["text"] });
			continue;
		}
		if ((item.type === undefined || item.type === "message") && typeof item["role"] === "string" && "content" in item) {
			appendResponsesChatMessage(messages, { role: item["role"], content: responseContentToChatContent(item["content"]) });
			continue;
		}
		throw ApiError.badRequest(`不支持的 input item type: ${String(item.type)}`);
	}
	return messages;
}

/**
 * Responses may represent one assistant turn as several text and function-call items.
 * Chat must keep that turn in one message so every tool result belongs to the same batch.
 * @param messages
 * @param message
 */
function appendResponsesChatMessage(messages: ChatMessage[], message: ChatMessage): void {
	const previous = messages.at(-1);
	if (message.role !== "assistant" || previous?.role !== "assistant") {
		messages.push(message);
		return;
	}

	if (message.content !== null && message.content !== undefined) {
		if (previous.content === null || previous.content === undefined) {
			previous.content = message.content;
		} else if (typeof previous.content === "string" && typeof message.content === "string") {
			previous.content += message.content;
		} else {
			previous.content = [
				...(Array.isArray(previous.content) ? previous.content : [{ type: "text", text: previous.content }]),
				...(Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }]),
			];
		}
	}
	if (message.tool_calls) {
		previous.tool_calls = [...(previous.tool_calls ?? []), ...message.tool_calls];
	}
}

function responseContentToChatContent(content: unknown): unknown {
	if (typeof content === "string" || content === null) {
		return content;
	}
	if (!Array.isArray(content)) {
		return typeof content === "object" && content !== null ? JSON.stringify(content) : String(content ?? "");
	}
	const textParts = content.filter(
		(part): part is { type: string; text: string } =>
			typeof part === "object" && part !== null && typeof part["type"] === "string" && typeof part["text"] === "string",
	);
	if (textParts.length === content.length) {
		return textParts.map((part) => part.text).join("");
	}
	return content.map((part) => {
		if (typeof part !== "object" || part === null) {
			return { type: "text", text: String(part) };
		}
		if ((part["type"] === "input_text" || part["type"] === "output_text") && typeof part["text"] === "string") {
			return { type: "text", text: part["text"] };
		}
		if (part["type"] === "input_image") {
			if (typeof part["image_url"] !== "string" || part["image_url"].length === 0) {
				if (typeof part["file_id"] === "string") {
					throw ApiError.badRequest("当前 Responses-to-Chat 兼容层不支持 input_image.file_id；请使用 image_url");
				}
				throw ApiError.badRequest("input_image.image_url 字段缺失");
			}
			return { type: "image_url", image_url: { url: part["image_url"], detail: part["detail"] } };
		}
		if (part["type"] === "input_file") {
			throw ApiError.badRequest("当前 Responses-to-Chat 兼容层不支持 input_file");
		}
		return part;
	});
}

const CHAT_FUNCTION_NAME_MAX_LENGTH = 64;

function responsesToolKey(name: string, namespace?: string): string {
	return `${namespace ?? ""}\0${name}`;
}

function buildChatFunctionTool(tool: ResponsesFunctionTool, name: string, namespaceDescription?: string): Record<string, unknown> {
	const description = [namespaceDescription, tool.description].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return {
		type: "function",
		function: {
			name: name,
			...(description.length > 0 ? { description: description.join("\n\n") } : {}),
			...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
			...(tool.strict !== undefined ? { strict: tool.strict } : {}),
		},
	};
}

function createNamespacedChatToolName(namespace: string, name: string, usedNames: Set<string>): string {
	const base = `${namespace}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
	if (base.length <= CHAT_FUNCTION_NAME_MAX_LENGTH && !usedNames.has(base)) {
		return base;
	}
	const digest = createHash("sha256").update(`${namespace}\0${name}`).digest("hex").slice(0, 12);
	const prefixLength = CHAT_FUNCTION_NAME_MAX_LENGTH - digest.length - 1;
	const prefix = base.slice(0, prefixLength);
	let candidate = `${prefix}_${digest}`;
	let collisionIndex = 1;
	while (usedNames.has(candidate)) {
		const suffix = `_${collisionIndex++}`;
		candidate = `${prefix.slice(0, CHAT_FUNCTION_NAME_MAX_LENGTH - digest.length - suffix.length - 1)}_${digest}${suffix}`;
	}
	return candidate;
}

function buildResponsesToolRegistry(tools: ResponsesTool[] | undefined): ResponsesToolRegistry {
	const chatTools: Record<string, unknown>[] = [];
	const responsesTools: Record<string, unknown>[] = [];
	const chatNameByResponsesName = new Map<string, string>();
	const responsesNameByChatName = new Map<string, ResponsesToolName>();
	const usedNames = new Set<string>();
	const sourceTools = Array.isArray(tools) ? tools : [];

	for (const value of sourceTools) {
		if (value?.type !== "function" || typeof value.name !== "string") {
			continue;
		}
		const tool = value as ResponsesFunctionTool;
		usedNames.add(tool.name);
		chatNameByResponsesName.set(responsesToolKey(tool.name), tool.name);
		responsesNameByChatName.set(tool.name, { name: tool.name });
	}

	for (const value of sourceTools) {
		if (value?.type === "function" && typeof value.name === "string") {
			const tool = value as ResponsesFunctionTool;
			chatTools.push(buildChatFunctionTool(tool, tool.name));
			responsesTools.push(structuredClone(tool) as unknown as Record<string, unknown>);
			continue;
		}
		if (value?.type === "namespace" && typeof value.name === "string" && Array.isArray((value as ResponsesNamespaceTool).tools)) {
			const namespaceTool = value as ResponsesNamespaceTool;
			responsesTools.push(structuredClone(namespaceTool) as unknown as Record<string, unknown>);
			for (const nestedValue of namespaceTool.tools) {
				if (nestedValue?.type !== "function" || typeof nestedValue.name !== "string") {
					continue;
				}
				const chatName = createNamespacedChatToolName(namespaceTool.name, nestedValue.name, usedNames);
				usedNames.add(chatName);
				chatNameByResponsesName.set(responsesToolKey(nestedValue.name, namespaceTool.name), chatName);
				responsesNameByChatName.set(chatName, { name: nestedValue.name, namespace: namespaceTool.name });
				chatTools.push(buildChatFunctionTool(nestedValue, chatName, namespaceTool.description));
			}
			continue;
		}
		if (typeof value === "object" && value !== null) {
			responsesTools.push(structuredClone(value) as unknown as Record<string, unknown>);
		}
	}

	return {
		chatTools: chatTools,
		responsesTools: responsesTools,
		toChatName: function (name: string, namespace?: string): string {
			return chatNameByResponsesName.get(responsesToolKey(name, namespace)) ?? name;
		},
		fromChatName: function (name: string): ResponsesToolName {
			return responsesNameByChatName.get(name) ?? { name: name };
		},
	};
}

function buildNativeResponsesRequestBody(body: ResponsesCreateRequest, toolRegistry: ResponsesToolRegistry): Record<string, unknown> {
	const nativeBody = structuredClone(body) as Record<string, unknown>;
	if (body.tools !== undefined) {
		nativeBody["tools"] = toolRegistry.responsesTools;
	}
	return nativeBody;
}

/**
 * 构造原生 Responses 能力调用。stream=false 用于 worker 与兼容回退；stream=true 用于主模型轮流式。
 * @param litellmRouter - 执行底层调用的 Router
 * @param requestBody - 客户端原始 Responses 请求体
 * @param originalMessages - 客户端原始消息，用于计算能力循环追加消息的偏移
 * @param toolRegistry - 工具名在 chat 与 Responses 协议间的映射表
 * @param streaming - 是否以流式方式发起
 */
function createNativeCapabilityCaller(
	litellmRouter: LiteLLMRouter,
	requestBody: ResponsesCreateRequest,
	originalMessages: Array<Record<string, unknown>>,
	toolRegistry: ResponsesToolRegistry,
	streaming: boolean,
): (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>> {
	let originalMessagesOffset: number | undefined;
	return async (model, messages, optionalParams) => {
		originalMessagesOffset ??= Math.max(0, messages.length - originalMessages.length);
		const nativeBody = buildNativeResponsesCapabilityBody(
			requestBody,
			messages as unknown as Array<Record<string, unknown>>,
			originalMessages,
			originalMessagesOffset,
			optionalParams,
			toolRegistry,
		);
		nativeBody["stream"] = streaming;
		const nativeParams: Record<string, unknown> = {
			...optionalParams,
			stream: streaming,
			[ROUTER_CALL_TYPE_PARAM]: "responses",
			[ROUTER_RESPONSES_BODY_PARAM]: nativeBody,
		};
		delete nativeParams["tools"];
		delete nativeParams["parallel_tool_calls"];
		return await litellmRouter.completion(model, messages as never, nativeParams);
	};
}

function createNativeResponsesCapabilityCompletion(
	litellmRouter: LiteLLMRouter,
	requestBody: ResponsesCreateRequest,
	originalMessages: Array<Record<string, unknown>>,
	toolRegistry: ResponsesToolRegistry,
): (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>> {
	const call = createNativeCapabilityCaller(litellmRouter, requestBody, originalMessages, toolRegistry, false);
	return async (model, messages, optionalParams) => {
		const result = await call(model, messages, optionalParams);
		return result["_responseProtocol"] === "responses"
			? mapNativeResponsesToChatCompletion(result, toolRegistry)
			: result;
	};
}

function buildNativeResponsesCapabilityBody(
	requestBody: ResponsesCreateRequest,
	messages: Array<Record<string, unknown>>,
	originalMessages: Array<Record<string, unknown>>,
	originalMessagesOffset: number,
	optionalParams: Record<string, unknown>,
	toolRegistry: ResponsesToolRegistry,
): Record<string, unknown> {
	const body = structuredClone(requestBody) as Record<string, unknown>;
	body["input"] = buildPreservedNativeResponsesInput(requestBody, messages, originalMessages, originalMessagesOffset, toolRegistry);
	body["stream"] = false;
	body["parallel_tool_calls"] = false;
	const privateTools = chatToolsToPrivateResponsesTools(optionalParams["tools"]);
	if (privateTools.length > 0) {
		body["tools"] = [...toolRegistry.responsesTools.map((tool) => structuredClone(tool)), ...privateTools];
	}
	return body;
}

function buildPreservedNativeResponsesInput(
	requestBody: ResponsesCreateRequest,
	messages: Array<Record<string, unknown>>,
	originalMessages: Array<Record<string, unknown>>,
	originalMessagesOffset: number,
	toolRegistry: ResponsesToolRegistry,
): Record<string, unknown>[] {
	const injectedMessages = messages.slice(0, originalMessagesOffset);
	const currentOriginalMessages = messages.slice(originalMessagesOffset, originalMessagesOffset + originalMessages.length);
	const continuationMessages = messages.slice(originalMessagesOffset + originalMessages.length);
	const instructionsCount = typeof requestBody.instructions === "string" && requestBody.instructions.length > 0 ? 1 : 0;
	const originalInput =
		typeof requestBody.input === "string"
			? [{ type: "message", role: "user", content: [{ type: "input_text", text: requestBody.input }] }]
			: Array.isArray(requestBody.input)
				? requestBody.input
				: [];
	const preservedInput = originalInput.map((item, index) => {
		const originalMessage = originalMessages[index + instructionsCount];
		const currentMessage = currentOriginalMessages[index + instructionsCount];
		const clonedItem = structuredClone(item) as Record<string, unknown>;
		if (!originalMessage || !currentMessage || isDeepStrictEqual(originalMessage, currentMessage)) {
			return clonedItem;
		}
		if ((item.type === undefined || item.type === "message") && "content" in item) {
			clonedItem["content"] = chatContentToResponsesContent(currentMessage["content"], String(item["role"] ?? "user"));
		}
		return clonedItem;
	});
	return [
		...chatMessagesToResponsesInput(injectedMessages, toolRegistry),
		...preservedInput,
		...chatMessagesToResponsesInput(continuationMessages, toolRegistry),
	];
}

function chatToolsToPrivateResponsesTools(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((tool) => {
		if (typeof tool !== "object" || tool === null || (tool as Record<string, unknown>)["type"] !== "function") {
			return [];
		}
		const fn = (tool as Record<string, unknown>)["function"];
		if (typeof fn !== "object" || fn === null) {
			return [];
		}
		const definition = fn as Record<string, unknown>;
		const name = definition["name"];
		if (typeof name !== "string" || !name.startsWith("litellm__")) {
			return [];
		}
		return [
			{
				type: "function",
				name: name,
				...(typeof definition["description"] === "string" ? { description: definition["description"] } : {}),
				...(typeof definition["parameters"] === "object" && definition["parameters"] !== null
					? { parameters: structuredClone(definition["parameters"]) }
					: {}),
				...(typeof definition["strict"] === "boolean" ? { strict: definition["strict"] } : {}),
			},
		];
	});
}

function chatMessagesToResponsesInput(
	messages: Array<Record<string, unknown>>,
	toolRegistry: ResponsesToolRegistry,
): Record<string, unknown>[] {
	const input: Record<string, unknown>[] = [];
	for (const message of messages) {
		const role = typeof message["role"] === "string" ? message["role"] : "user";
		if (role === "tool" && typeof message["tool_call_id"] === "string") {
			input.push({
				type: "function_call_output",
				call_id: message["tool_call_id"],
				output: typeof message["content"] === "string" ? message["content"] : JSON.stringify(message["content"] ?? ""),
			});
			continue;
		}
		if (message["content"] !== null && message["content"] !== undefined) {
			input.push({
				type: "message",
				role: role,
				content: chatContentToResponsesContent(message["content"], role),
			});
		}
		const toolCalls = Array.isArray(message["tool_calls"]) ? (message["tool_calls"] as ToolCall[]) : [];
		for (const toolCall of toolCalls) {
			const mapped = toolRegistry.fromChatName(toolCall.function.name);
			input.push({
				type: "function_call",
				call_id: toolCall.id,
				name: mapped.name,
				...(mapped.namespace ? { namespace: mapped.namespace } : {}),
				arguments: toolCall.function.arguments,
			});
		}
	}
	return input;
}

function chatContentToResponsesContent(content: unknown, role: string): unknown {
	const textType = role === "assistant" ? "output_text" : "input_text";
	if (typeof content === "string") {
		return [{ type: textType, text: content }];
	}
	if (!Array.isArray(content)) {
		return [{ type: textType, text: JSON.stringify(content ?? "") }];
	}
	return content.map((rawPart) => {
		if (typeof rawPart !== "object" || rawPart === null) {
			return { type: textType, text: String(rawPart ?? "") };
		}
		const part = rawPart as Record<string, unknown>;
		if (part["type"] === "text" && typeof part["text"] === "string") {
			return { type: textType, text: part["text"] };
		}
		if (part["type"] === "image_url") {
			const imageUrl = part["image_url"];
			const url =
				typeof imageUrl === "string"
					? imageUrl
					: typeof imageUrl === "object" && imageUrl !== null
						? (imageUrl as Record<string, unknown>)["url"]
						: undefined;
			if (typeof url === "string") {
				return { type: "input_image", image_url: url };
			}
		}
		return structuredClone(part);
	});
}

function mapNativeResponsesToChatCompletion(result: Record<string, unknown>, toolRegistry: ResponsesToolRegistry): Record<string, unknown> {
	const output = Array.isArray(result["output"]) ? (result["output"] as Array<Record<string, unknown>>) : [];
	const toolCalls: ToolCall[] = [];
	const text: string[] = [];
	const refusal: string[] = [];
	const reasoning: string[] = [];
	for (const item of output) {
		if (item["type"] === "function_call" && typeof item["name"] === "string") {
			const namespace = typeof item["namespace"] === "string" ? item["namespace"] : undefined;
			toolCalls.push({
				id: typeof item["call_id"] === "string" ? item["call_id"] : String(item["id"] ?? `call_${randomUUID()}`),
				type: "function",
				function: {
					name: toolRegistry.toChatName(item["name"], namespace),
					arguments: typeof item["arguments"] === "string" ? item["arguments"] : JSON.stringify(item["arguments"] ?? {}),
				},
			});
			continue;
		}
		if (item["type"] === "message" && Array.isArray(item["content"])) {
			for (const content of item["content"] as Array<Record<string, unknown>>) {
				if ((content["type"] === "output_text" || content["type"] === "text") && typeof content["text"] === "string") {
					text.push(content["text"]);
				}
				if (content["type"] === "refusal" && typeof content["refusal"] === "string") {
					refusal.push(content["refusal"]);
				}
			}
			continue;
		}
		if (item["type"] === "reasoning") {
			const itemText = reasoningTextFromBlock(item, ["text", "content"]);
			if (itemText.length > 0) {
				reasoning.push(itemText);
			}
		}
	}
	const usage = result["usage"] as Record<string, unknown> | undefined;
	const message: Record<string, unknown> = {
		role: "assistant",
		content: text.length > 0 ? text.join("") : null,
		...(refusal.length > 0 ? { refusal: refusal.join("") } : {}),
		...(reasoning.length > 0 ? { reasoning_content: reasoning.join("\n") } : {}),
		...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
	};
	const chatResult: Record<string, unknown> = {
		id: result["id"],
		created: result["created_at"],
		model: result["model"],
		choices: [
			{
				index: 0,
				finish_reason: toolCalls.length > 0 ? "tool_calls" : result["status"] === "incomplete" ? "length" : "stop",
				message: message,
			},
		],
		usage: toChatUsage(usage ?? {}),
		_responseProtocol: "chat_completions",
	};
	for (const [key, value] of Object.entries(result)) {
		if (key.startsWith("_") && key !== "_responseProtocol") {
			chatResult[key] = value;
		}
	}
	return chatResult;
}

function normalizeResponsesToolChoice(value: unknown, toolRegistry: ResponsesToolRegistry): unknown {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const choice = value as Record<string, unknown>;
	if (choice["type"] === "function" && typeof choice["name"] === "string") {
		const namespace = typeof choice["namespace"] === "string" ? choice["namespace"] : undefined;
		return {
			type: "function",
			function: { name: toolRegistry.toChatName(choice["name"], namespace) },
		};
	}
	if (choice["type"] === "namespace") {
		return "required";
	}
	return undefined;
}

function buildResponsesOptionalParams(body: ResponsesCreateRequest, toolRegistry: ResponsesToolRegistry): Record<string, unknown> {
	const optionalParams: Record<string, unknown> = { ...body };
	delete optionalParams["model"];
	delete optionalParams["input"];
	delete optionalParams["instructions"];
	if (typeof body.max_output_tokens === "number" && optionalParams["max_completion_tokens"] === undefined) {
		optionalParams["max_completion_tokens"] = body.max_output_tokens;
	}
	delete optionalParams["max_output_tokens"];
	const reasoning = body.reasoning as Record<string, unknown> | undefined;
	if (typeof reasoning?.["effort"] === "string" && optionalParams["reasoning_effort"] === undefined) {
		optionalParams["reasoning_effort"] = reasoning["effort"];
	}
	delete optionalParams["reasoning"];
	if (body.tools) {
		optionalParams["tools"] = toolRegistry.chatTools;
	}
	if (body.tool_choice !== undefined) {
		const toolChoice = normalizeResponsesToolChoice(body.tool_choice, toolRegistry);
		if (toolChoice === undefined) {
			delete optionalParams["tool_choice"];
		} else {
			optionalParams["tool_choice"] = toolChoice;
		}
	}
	return optionalParams;
}

function mapChatCompletionToResponse(
	result: Record<string, unknown>,
	request: ResponsesCreateRequest,
	toolRegistry: ResponsesToolRegistry,
): StandardResponseObject {
	const responseId = toResponseId(result["id"]);
	const createdAt = typeof result["created"] === "number" ? result["created"] : Math.floor(Date.now() / 1000);
	const model = typeof result["model"] === "string" ? result["model"] : request.model!;
	const choice = Array.isArray(result["choices"]) ? (result["choices"][0] as Record<string, unknown> | undefined) : undefined;
	const message = (choice?.["message"] as Record<string, unknown> | undefined) ?? {};
	const finishReason = typeof choice?.["finish_reason"] === "string" ? choice["finish_reason"] : "stop";
	const output: ResponseOutputItem[] = [];
	const reasoning = extractReasoningText(message);
	// 上游可能只产出空白（实测是一个空格、reasoning_tokens 为 1）；为空时不生成 output item，
	// 免得客户端渲染出一个没有内容的思考区。
	if (reasoning.trim().length > 0) {
		output.push(buildReasoningItem(responseId, output.length, reasoning));
	}
	const text = typeof message["content"] === "string" ? message["content"] : "";
	const refusal = typeof message["refusal"] === "string" ? message["refusal"] : "";
	if (text.length > 0 || refusal.length > 0) {
		output.push(buildMessageItem(responseId, output.length, text, refusal));
	}
	for (const toolCall of (message["tool_calls"] as ToolCall[] | undefined) ?? []) {
		output.push(buildFunctionCallItem(responseId, output.length, toolCall, toolRegistry));
	}
	for (const image of (result["_builtinGeneratedImages"] as BuiltinGeneratedImage[] | undefined) ?? []) {
		output.push({
			id: image.id,
			type: "image_generation_call",
			status: "completed",
			result: image.b64Json,
			output_format: image.outputFormat,
			size: image.size ?? "auto",
			quality: image.quality ?? "auto",
			background: image.background ?? "auto",
		});
	}
	const usage = mapResponseUsage(result["usage"] as Record<string, unknown> | undefined);
	const status = finishReason === "length" ? "incomplete" : finishReason === "content_filter" ? "failed" : "completed";
	const error = status === "failed" ? { code: "content_filter", message: "Response blocked by content filter" } : null;
	const response = buildResponseObject({
		id: responseId,
		createdAt: createdAt,
		status: status,
		error: error,
		instructions: request.instructions ?? null,
		model: model,
		output: output,
		usage: usage,
		request: request,
		incompleteDetails: status === "incomplete" ? { reason: "max_output_tokens" } : null,
	});
	return response;
}

function buildNativeResponsesClientObject(
	result: Record<string, unknown>,
	request: ResponsesCreateRequest,
	toolRegistry: ResponsesToolRegistry,
): Record<string, unknown> {
	const publicResult = Object.fromEntries(Object.entries(result).filter(([key]) => !key.startsWith("_")));
	const response = structuredClone(publicResult) as Record<string, unknown>;
	restoreNativeResponsesPayload(response, request, toolRegistry);
	const usage =
		typeof response["usage"] === "object" && response["usage"] !== null && !Array.isArray(response["usage"])
			? ({ ...(response["usage"] as Record<string, unknown>) } as Record<string, unknown>)
			: undefined;
	if (usage) {
		delete usage["cost"];
		response["usage"] = usage;
	}
	return response;
}

function restoreNativeResponsesPayload(
	payload: Record<string, unknown>,
	request: ResponsesCreateRequest,
	toolRegistry: ResponsesToolRegistry,
): void {
	restoreNativeFunctionCallItem(payload["item"], toolRegistry);
	const response =
		typeof payload["response"] === "object" && payload["response"] !== null && !Array.isArray(payload["response"])
			? (payload["response"] as Record<string, unknown>)
			: payload["object"] === "response"
				? payload
				: undefined;
	if (response) {
		for (const item of Array.isArray(response["output"]) ? response["output"] : []) {
			restoreNativeFunctionCallItem(item, toolRegistry);
		}
		if (request.tools !== undefined) {
			response["tools"] = structuredClone(request.tools);
		}
		if (request.tool_choice !== undefined) {
			response["tool_choice"] = structuredClone(request.tool_choice);
		}
	}
	if (payload["type"] === "response.function_call_arguments.done" && typeof payload["name"] === "string") {
		const toolName =
			typeof payload["namespace"] === "string"
				? { name: payload["name"], namespace: payload["namespace"] }
				: toolRegistry.fromChatName(payload["name"]);
		payload["name"] = toolName.name;
		if (toolName.namespace !== undefined) {
			payload["namespace"] = toolName.namespace;
		}
	}
}

function restoreNativeFunctionCallItem(value: unknown, toolRegistry: ResponsesToolRegistry): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return;
	}
	const item = value as Record<string, unknown>;
	if (item["type"] !== "function_call" || typeof item["name"] !== "string") {
		return;
	}
	const toolName =
		typeof item["namespace"] === "string"
			? { name: item["name"], namespace: item["namespace"] }
			: toolRegistry.fromChatName(item["name"]);
	item["name"] = toolName.name;
	if (toolName.namespace !== undefined) {
		item["namespace"] = toolName.namespace;
	} else {
		delete item["namespace"];
	}
}

function buildResponseObject(input: {
	id: string;
	createdAt: number;
	status: StandardResponseObject["status"];
	error: ResponseError | null;
	instructions: string | null;
	model: string;
	output: ResponseOutputItem[];
	usage: ResponseUsage | null;
	request: ResponsesCreateRequest;
	incompleteDetails?: Record<string, unknown> | null;
}): StandardResponseObject {
	return {
		id: input.id,
		object: "response",
		created_at: input.createdAt,
		completed_at: input.status === "completed" ? Math.floor(Date.now() / 1000) : null,
		status: input.status,
		error: input.error,
		incomplete_details: input.incompleteDetails ?? null,
		instructions: input.instructions,
		max_output_tokens: input.request.max_output_tokens ?? null,
		model: input.model,
		output: input.output,
		parallel_tool_calls: input.request.parallel_tool_calls ?? true,
		previous_response_id: input.request.previous_response_id ?? null,
		reasoning: input.request.reasoning ?? { effort: null, summary: null },
		store: false,
		temperature: input.request.temperature ?? 1,
		text: input.request.text ?? { format: { type: "text" } },
		tool_choice: input.request.tool_choice ?? "auto",
		tools: input.request.tools ?? [],
		top_p: input.request.top_p ?? 1,
		truncation: input.request.truncation ?? "disabled",
		usage: input.usage,
		user: input.request.user ?? null,
		metadata: input.request.metadata ?? {},
	};
}

function toResponseId(value: unknown): string {
	if (typeof value === "string" && value.startsWith("resp_")) {
		return value;
	}
	if (typeof value === "string" && value.length > 0) {
		const separator = value.indexOf("-");
		return `resp_${separator >= 0 ? value.slice(separator + 1) : value}`;
	}
	return `resp_${randomUUID()}`;
}

function buildReasoningItem(responseId: string, index: number, text: string): ResponseOutputItem {
	return {
		id: `${responseId}_reasoning_${index}`,
		type: "reasoning",
		status: "completed",
		summary: [],
		content: [{ type: "reasoning_text", text: text }],
	};
}

function buildMessageItem(responseId: string, index: number, text: string, refusal = ""): ResponseOutputItem {
	const content: Array<Record<string, unknown>> = [];
	if (text.length > 0) {
		content.push({ type: "output_text", annotations: [], logprobs: [], text: text });
	}
	if (refusal.length > 0) {
		content.push({ type: "refusal", refusal: refusal });
	}
	return {
		id: `${responseId}_message_${index}`,
		type: "message",
		status: "completed",
		role: "assistant",
		content: content,
	};
}

function buildFunctionCallItem(
	responseId: string,
	index: number,
	toolCall: ToolCall,
	toolRegistry: ResponsesToolRegistry,
): ResponseOutputItem {
	const toolName = toolRegistry.fromChatName(toolCall.function.name);
	return {
		id: `${responseId}_function_${index}`,
		type: "function_call",
		status: "completed",
		call_id: toolCall.id,
		name: toolName.name,
		...(toolName.namespace !== undefined ? { namespace: toolName.namespace } : {}),
		arguments: toolCall.function.arguments,
	};
}

function extractReasoningText(message: Record<string, unknown>): string {
	const segments: string[] = [];
	if (typeof message["reasoning_content"] === "string" && message["reasoning_content"].length > 0) {
		segments.push(message["reasoning_content"]);
	}
	for (const block of (message["thinking_blocks"] as ThinkingBlock[] | undefined) ?? []) {
		if (block.thinking && !segments.includes(block.thinking)) {
			segments.push(block.thinking);
		}
	}
	return segments.join("\n");
}

function mapResponseUsage(usage: Record<string, unknown> | undefined): ResponseUsage | null {
	if (!usage) {
		return null;
	}
	const inputTokens = numberField(usage, "prompt_tokens", "input_tokens");
	const outputTokens = numberField(usage, "completion_tokens", "output_tokens");
	const inputDetails =
		(usage["prompt_tokens_details"] as Record<string, unknown> | undefined) ??
		(usage["input_tokens_details"] as Record<string, unknown> | undefined);
	const outputDetails =
		(usage["completion_tokens_details"] as Record<string, unknown> | undefined) ??
		(usage["output_tokens_details"] as Record<string, unknown> | undefined);
	return {
		input_tokens: inputTokens,
		input_tokens_details: {
			cached_tokens: numberField(inputDetails, "cached_tokens") || numberField(usage, "cache_read_input_tokens"),
		},
		output_tokens: outputTokens,
		output_tokens_details: { reasoning_tokens: numberField(outputDetails, "reasoning_tokens") },
		total_tokens: numberField(usage, "total_tokens") || inputTokens + outputTokens,
		...(typeof usage?.["cost"] === "number" && Number.isFinite(usage["cost"]) ? { cost: usage["cost"] } : {}),
	};
}

function numberField(record: Record<string, unknown> | undefined, ...keys: string[]): number {
	for (const key of keys) {
		if (typeof record?.[key] === "number") {
			return record[key] as number;
		}
	}
	return 0;
}

async function handleResponsesStream(context: ResponsesStreamContext): Promise<void> {
	const {
		litellmRouter,
		model,
		messages,
		optionalParams,
		requestBody,
		req,
		res,
		db,
		requestId,
		startTime,
		lifecycle,
		visionImageStore,
		toolRegistry,
	} = context;
	const state: ResponsesStreamState = {
		responseId: `resp_${randomUUID()}`,
		createdAt: Math.floor(Date.now() / 1000),
		model: model,
		instructions: requestBody.instructions ?? null,
		output: [],
		tools: new Map(),
		text: "",
		refusal: "",
		reasoning: "",
		nextContentIndex: 0,
		sequence: 0,
		terminalSent: false,
		toolRegistry: toolRegistry,
	};
	let capabilitySseStarted = false;
	let capabilityFirstChunkAt: Date | undefined;
	let capabilityVisibleDeltas = false;
	let streamResult: Record<string, unknown>;
	try {
		const capabilityMessages = messages as unknown as Array<Record<string, unknown>>;
		const nativeResponses = litellmRouter.supportsNativeResponses?.(model) ?? false;
		const preparedVision = await prepareOpenAIVisionRequest(litellmRouter, model, capabilityMessages, visionImageStore);
		const preparedImageGeneration = await prepareOpenAIImageGenerationRequest(
			litellmRouter,
			model,
			capabilityMessages,
			visionImageStore,
		);
		const preparedWeb = await prepareOpenAIWebRequest(litellmRouter, model, capabilityMessages);
		if (preparedVision || preparedImageGeneration || preparedWeb) {
			// 工具执行与 worker 调用保持非流式；主模型轮的可见文本边收边发。
			if (!res.headersSent) {
				res.status(200);
				res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
				res.setHeader("Cache-Control", "no-cache");
				res.setHeader("Connection", "keep-alive");
				res.setHeader("X-Accel-Buffering", "no");
			}
			res.flushHeaders();
			capabilitySseStarted = true;
			writeEvent(res, state, "response.created", {
				response: buildStreamResponse(state, requestBody, "in_progress", null),
			});
			writeEvent(res, state, "response.in_progress", {
				response: buildStreamResponse(state, requestBody, "in_progress", null),
			});
			const nativeCompletion = nativeResponses
				? createNativeResponsesCapabilityCompletion(litellmRouter, requestBody, capabilityMessages, toolRegistry)
				: undefined;
			// 支持原生 Responses 的 provider：能力主轮也走原生协议。能力循环内部仍以 chat 形态
			// 记账，但每一轮都用原生 Responses 请求体发往上游，客户端收到的就是上游的
			// reasoning/文本增量，而不是“responses→chat→responses”往返后的合成结果。
			const nativeStreaming = nativeResponses
				? createNativeCapabilityCaller(litellmRouter, requestBody, capabilityMessages, toolRegistry, true)
				: undefined;
			const chatStreamingMainTurn = async (
				completionModel: string,
				completionMessages: Message[],
				params: Record<string, unknown>,
			): Promise<Record<string, unknown>> => {
				const chatParams: Record<string, unknown> = { ...params, stream: true };
				delete chatParams[ROUTER_CALL_TYPE_PARAM];
				delete chatParams[ROUTER_RESPONSES_BODY_PARAM];
				return await litellmRouter.completion(completionModel, completionMessages as never, chatParams);
			};
			const streamingMainTurn = async (
				completionModel: string,
				completionMessages: Message[],
				params: Record<string, unknown>,
			): Promise<Record<string, unknown>> => {
				let streamed: Record<string, unknown>;
				if (nativeStreaming) {
					try {
						streamed = await nativeStreaming(completionModel, completionMessages, params);
					} catch {
						// 原生流失败时退回 chat，保持既有可用性兜底。
						try {
							streamed = await chatStreamingMainTurn(completionModel, completionMessages, params);
						} catch (error) {
							if (nativeCompletion) {
								return nativeCompletion(completionModel, completionMessages, params);
							}
							throw error;
						}
					}
				} else {
					try {
						streamed = await chatStreamingMainTurn(completionModel, completionMessages, params);
					} catch (error) {
						// 上游不支持流式时回退到既有非流式能力调用。
						if (nativeCompletion) {
							return nativeCompletion(completionModel, completionMessages, params);
						}
						throw error;
					}
				}
				const upstreamStream = streamed["stream"];
				if (!isAsyncIterable(upstreamStream)) {
					// 部分供应商即使请求 stream 也只返回完整 SSE 文本，这里就地解析。
					const rawBody = streamed["body"];
					if (typeof rawBody === "string" && rawBody.includes("data:")) {
						const bufferedAccumulator = new NativeResponsesAccumulator();
						for (const record of toNativeResponseEvents(rawBody)) {
							bufferedAccumulator.accumulate(record);
							const chunk = nativeResponsesEventToChatChunk(record);
							if (chunk === undefined) {
								continue;
							}
							capabilityFirstChunkAt ??= new Date();
							capabilityVisibleDeltas = true;
							consumeChatStreamChunk(chunk, state, res);
						}
						const bufferedSnapshot = bufferedAccumulator.snapshot();
						if (bufferedSnapshot !== null) {
							const mapped = mapNativeResponsesToChatCompletion(bufferedSnapshot, toolRegistry);
							for (const [key, value] of Object.entries(streamed)) {
								if (key.startsWith("_")) {
									mapped[key] = value;
								}
							}
							return mapped;
						}
					}
					return streamed;
				}
				if (streamed["_responseProtocol"] === "responses") {
					// 原生 Responses SSE：转成内部 chat chunk 后走同一条下发管道。
					const nativeAccumulator = new NativeResponsesAccumulator();
					const parseNativeEvents = createNativeEventParser();
					for await (const raw of upstreamStream as AsyncIterable<unknown>) {
						for (const record of parseNativeEvents(raw)) {
							nativeAccumulator.accumulate(record);
							const chunk = nativeResponsesEventToChatChunk(record);
							if (chunk === undefined) {
								continue;
							}
							capabilityFirstChunkAt ??= new Date();
							capabilityVisibleDeltas = true;
							consumeChatStreamChunk(chunk, state, res);
						}
					}
					const snapshot = nativeAccumulator.snapshot();
					if (snapshot === null) {
						return streamed;
					}
					const mapped = mapNativeResponsesToChatCompletion(snapshot, toolRegistry);
					// 流式包装上的计费/追踪元数据不在累加结果里，需要显式带回。
					for (const [key, value] of Object.entries(streamed)) {
						if (key.startsWith("_")) {
							mapped[key] = value;
						}
					}
					return mapped;
				}
				const accumulator: ChatStreamAccumulator = { choices: new Map(), estimatedCompletionTokens: 0 };
				for await (const chunk of upstreamStream as AsyncIterable<unknown>) {
					capabilityFirstChunkAt ??= new Date();
					capabilityVisibleDeltas = true;
					consumeChatStreamChunk(stripPrivateToolDeltas(chunk), state, res);
					accumulateChatChunk(accumulator, chunk as ModelResponseStream);
				}
				return finalizeStreamedCompletion(accumulator, completionModel, streamed);
			};
			const finalResult = await runOpenAIBuiltinCapabilityAgentLoop(
				litellmRouter,
				model,
				capabilityMessages,
				optionalParams,
				streamingMainTurn,
				{
					visionAudit: createVisionCapabilityAuditHook({ db: db, req: req, parentRequestId: requestId }),
					imageGenerationAudit: createImageGenerationCapabilityAuditHook({
						db: db,
						req: req,
						parentRequestId: requestId,
					}),
					webAudit: createWebCapabilityAuditHook({ db: db, req: req, parentRequestId: requestId }),
					visionImageStore: visionImageStore,
					preparedVision: preparedWeb ? undefined : preparedVision,
					preparedWeb: preparedWeb,
					workerComplete: nativeCompletion
						? nativeCompletion
						: (workerModel: string, workerMessages: Message[], workerParams: Record<string, unknown>) =>
								litellmRouter.completion(workerModel, workerMessages as never, workerParams),
				},
			);
			if (finalResult["usage"] !== undefined) {
				state.usage = finalResult["usage"] as Usage;
			}
			// 上游详情由请求作用域的旁路通道记录，重建结果对象不会丢；这里只拼下游协议字段。
			streamResult = {
				...finalResult,
				_responseProtocol: "chat_completions",
				_stream: true,
				stream: modelResponseToSyntheticStream(finalResult, capabilityVisibleDeltas),
			};
		} else {
			streamResult = await litellmRouter.completion(model, messages as never, optionalParams);
		}
	} catch (error) {
		// 能力分支会先写出 response.created / response.in_progress，再逐块下发真实上游增量。
		// 这条 SSE 一旦开始，失败就必须以 Responses 的终态事件收尾：继续向上抛会让上层把
		// chat 格式的 {error} 帧塞进这条流，客户端读不到 response.failed，只看到被截断的响应。
		const failedAfterSseStarted = capabilitySseStarted && res.headersSent;
		const failureBody = failedAfterSseStarted
			? buildStreamResponse(state, requestBody, "failed", {
					code: streamErrorCode(error),
					message: errorMessage(error),
				})
			: undefined;
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				response: failureBody,
				completionStartTime: capabilityFirstChunkAt,
				error: error,
				upstreamLogContext: getUpstreamLogContext(error),
				status: SpendLogStatus.Failure,
				...getResultModelResolutionMetadata(error as unknown as Record<string, unknown>),
			}),
		);
		if (failureBody !== undefined) {
			writeTerminalEvent(res, state, "response.failed", { response: failureBody });
			if (!res.writableEnded) {
				res.end();
			}
			return;
		}
		throw error;
	}
	const stream = streamResult["stream"];
	if (streamResult["_stream"] !== true || !isAsyncIterable(stream)) {
		const error = ApiError.unavailable("Provider 未返回流式响应");
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				error: error,
				upstreamLogContext: getUpstreamLogContext(streamResult),
				status: SpendLogStatus.Failure,
				...getResultModelResolutionMetadata(streamResult),
			}),
		);
		throw error;
	}
	if (streamResult["_responseProtocol"] === "responses") {
		await relayNativeResponsesStream(context, streamResult, stream);
		return;
	}

	if (!res.headersSent) {
		copyProviderHeaders(streamResult, res);
		res.status(200);
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");
	}

	res.flushHeaders();
	const stopKeepalive = await startSseKeepalive(
		req,
		res,
		getKeepaliveDeployment(litellmRouter, model, (streamResult["_spendInfo"] as DeploymentSpendInfo | undefined)?.modelId),
	);

	const checkpointRequestId = requestId;
	const checkpointDb = db;
	let streamingCheckpointScheduler: StreamingCheckpointScheduler<StreamingCheckpoint> | undefined;
	if (checkpointRequestId !== undefined && checkpointDb !== undefined) {
		streamingCheckpointScheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
			serialize: () => {
				const response = buildStreamResponse(state, requestBody, "in_progress", null);
				const upstream = getUpstreamLogContext(streamResult);
				return {
					protocol: "responses",
					state: "in_progress",
					response: response as unknown as Record<string, unknown>,
					usage: (state.usage ?? null) as unknown as Record<string, unknown> | null,
					upstream_request: (upstream?.request ?? null) as Record<string, unknown> | null,
					upstream_response: (upstream?.response ?? null) as Record<string, unknown> | null,
				};
			},
			write: (checkpoint) => checkpointActiveRequest(checkpointDb, checkpointRequestId, checkpoint, "streaming_execution"),
		});
	}

	if (!capabilitySseStarted) {
		writeEvent(res, state, "response.created", {
			response: buildStreamResponse(state, requestBody, "in_progress", null),
		});
		writeEvent(res, state, "response.in_progress", {
			response: buildStreamResponse(state, requestBody, "in_progress", null),
		});
	}

	const iterator = stream[Symbol.asyncIterator]();
	let clientAborted = false;
	let rejectClientAbort: ((error: Error) => void) | undefined;
	const clientAbort = new Promise<never>((_resolve, reject) => {
		rejectClientAbort = reject;
	});
	const onClose = (): void => {
		if (!res.writableEnded && !clientAborted) {
			clientAborted = true;
			rejectClientAbort?.(Object.assign(new Error("client aborted"), { name: "AbortError" }));
		}
	};
	res.once("close", onClose);
	let firstChunkAt: Date | undefined;
	let terminalError: unknown;
	try {
		while (true) {
			const current = await Promise.race([iterator.next(), clientAbort]);
			if (current.done) {
				break;
			}
			firstChunkAt ??= new Date();
			consumeChatStreamChunk(current.value, state, res);
			streamingCheckpointScheduler?.onChunk();
		}
		writeCompletedEvents(res, state);
		const terminalStatus =
			state.finishReason === "length" ? "incomplete" : state.finishReason === "content_filter" ? "failed" : "completed";
		const terminalError =
			terminalStatus === "failed" ? { code: "content_filter", message: "Response blocked by content filter" } : null;
		const completed = buildStreamResponse(state, requestBody, terminalStatus, terminalError);
		writeTerminalEvent(
			res,
			state,
			terminalStatus === "incomplete"
				? "response.incomplete"
				: terminalStatus === "failed"
					? "response.failed"
					: "response.completed",
			{ response: completed },
		);
		if (!res.writableEnded) {
			res.end();
		}
		const loggedCompleted = { ...completed } as Record<string, unknown>;
		const spendInfo = (streamResult as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
		await streamingCheckpointScheduler?.dispose();
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				// 能力分支已经把真实上游增量边收边发，capabilityFirstChunkAt 才是用户看到首字的时刻；
				// 收尾时下游读到的是事后合成流，它的 firstChunkAt 会晚到总耗时末尾。
				completionStartTime: capabilityFirstChunkAt ?? firstChunkAt,
				response: loggedCompleted,
				usage: state.usage as unknown as Record<string, unknown> | undefined,
				spendInfo: spendInfo,
				upstreamLogContext: getUpstreamLogContext(streamResult),
				status: SpendLogStatus.Success,
				...getResultModelResolutionMetadata(streamResult),
			}),
		);
	} catch (error) {
		terminalError = error;
		await streamingCheckpointScheduler?.dispose();
		if (!clientAborted) {
			const responseError = { code: streamErrorCode(error), message: errorMessage(error) };
			writeTerminalEvent(res, state, "response.failed", {
				response: buildStreamResponse(state, requestBody, "failed", responseError),
			});
			if (!res.writableEnded) {
				res.end();
			}
		}
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				completionStartTime: firstChunkAt,
				response: buildStreamResponse(state, requestBody, "failed", {
					code: streamErrorCode(error),
					message: errorMessage(error),
				}),
				usage: state.usage as unknown as Record<string, unknown> | undefined,
				error: error,
				upstreamLogContext: getUpstreamLogContext(streamResult),
				status: SpendLogStatus.Failure,
				...getResultModelResolutionMetadata(streamResult),
			}),
		);
	} finally {
		stopKeepalive();
		res.removeListener("close", onClose);
		if (terminalError !== undefined && iterator.return) {
			void iterator.return().catch(() => undefined);
		}
		if (!res.writableEnded && !clientAborted) {
			res.end();
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 原生 Responses 协议流的中间响应累积器。
 * 对齐 CLIProxy extractNativeResponse 的 partial 思路，但累积标准 output item 结构，
 * 供流式进行中 checkpoint 出可展示的部分 response。
 */
class NativeResponsesAccumulator {
	private _id?: string;
	private _model?: string;
	private _output: Record<string, unknown>[] = [];
	private _text = "";
	private _reasoning = "";
	private _usage: Record<string, unknown> | undefined;

	accumulate(event: Record<string, unknown>): void {
		const type = typeof event["type"] === "string" ? event["type"] : "";
		if (type === "response.created" || type === "response.in_progress") {
			const response = asResponseRecord(event["response"]);
			if (response) {
				this._id ??= typeof response["id"] === "string" ? response["id"] : undefined;
				this._model ??= typeof response["model"] === "string" ? response["model"] : undefined;
				if (Array.isArray(response["output"])) {
					this._output = response["output"].filter(isRecord).map((item) => structuredClone(item));
				}
			}
		} else if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
			this._text += event["delta"];
		} else if (type === "response.output_text.done" && typeof event["text"] === "string") {
			this._text = event["text"];
		} else if (type === "response.reasoning_text.delta" && typeof event["delta"] === "string") {
			this._reasoning += event["delta"];
		} else if (type === "response.output_item.done") {
			const item = asResponseRecord(event["item"]);
			if (item) {
				this._output.push(structuredClone(item));
			}
		} else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
			const response = asResponseRecord(event["response"]);
			if (response) {
				this._id = typeof response["id"] === "string" ? response["id"] : this._id;
				this._model = typeof response["model"] === "string" ? response["model"] : this._model;
				if (Array.isArray(response["output"])) {
					this._output = response["output"].filter(isRecord).map((item) => structuredClone(item));
				}
				const usage = asResponseRecord(response["usage"]);
				if (usage) {
					this._usage = structuredClone(usage);
				}
			}
		}
	}

	snapshot(): Record<string, unknown> | null {
		if (
			this._id === undefined &&
			this._model === undefined &&
			this._output.length === 0 &&
			this._text === "" &&
			this._reasoning === ""
		) {
			return null;
		}
		const output = [...this._output];
		if (this._text !== "") {
			output.push({
				type: "message",
				role: "assistant",
				status: "in_progress",
				content: [{ type: "output_text", text: this._text }],
			});
		}
		if (this._reasoning !== "") {
			output.push({
				type: "reasoning",
				content: [{ type: "reasoning_text", text: this._reasoning }],
			});
		}
		return {
			id: this._id ?? "",
			object: "response",
			status: "in_progress",
			model: this._model,
			output: output,
			usage: this._usage ?? null,
		};
	}
}

function asResponseRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

/** 原生 Responses 的语义增量事件：只有这些 type 才能反映「模型开始产出内容」。 */
const NATIVE_RESPONSES_CONTENT_DELTA_TYPES = new Set<string>([
	"response.output_text.delta",
	"response.reasoning_text.delta",
	"response.reasoning_summary_text.delta",
	"response.refusal.delta",
	"response.function_call_arguments.delta",
	"response.custom_tool_call_input.delta",
]);

/**
 * 判断原生 Responses 事件是否是承载模型产出的增量事件。
 * @param type
 */
function isNativeResponsesContentDelta(type: string): boolean {
	return NATIVE_RESPONSES_CONTENT_DELTA_TYPES.has(type);
}

async function relayNativeResponsesStream(
	context: ResponsesStreamContext,
	streamResult: Record<string, unknown>,
	stream: AsyncIterable<unknown>,
): Promise<void> {
	const { res, requestBody, toolRegistry, lifecycle, db, req, requestId, model, startTime } = context;
	if (!res.headersSent) {
		copyProviderHeaders(streamResult, res);
		res.status(200);
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");
	}

	res.flushHeaders();
	const stopKeepalive = await startSseKeepalive(
		req,
		res,
		getKeepaliveDeployment(context.litellmRouter, model, (streamResult["_spendInfo"] as DeploymentSpendInfo | undefined)?.modelId),
	);

	const iterator = stream[Symbol.asyncIterator]();
	const nativeAccumulator = new NativeResponsesAccumulator();
	const checkpointRequestId = requestId;
	const checkpointDb = db;
	let streamingCheckpointScheduler: StreamingCheckpointScheduler<StreamingCheckpoint> | undefined;
	if (checkpointRequestId !== undefined && checkpointDb !== undefined) {
		streamingCheckpointScheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
			serialize: () => {
				const response = nativeAccumulator.snapshot();
				if (response === null) {
					return null;
				}
				const upstream = getUpstreamLogContext(streamResult);
				return {
					protocol: "responses_native",
					state: "in_progress",
					response: response,
					usage: isRecord(response["usage"]) ? response["usage"] : null,
					upstream_request: (upstream?.request ?? null) as Record<string, unknown> | null,
					upstream_response: (upstream?.response ?? null) as Record<string, unknown> | null,
				};
			},
			write: (checkpoint) => checkpointActiveRequest(checkpointDb, checkpointRequestId, checkpoint, "streaming_execution"),
		});
	}
	let clientAborted = false;
	let terminalType: "response.completed" | "response.incomplete" | "response.failed" | undefined;
	let terminalResponse: Record<string, unknown> | undefined;
	let upstreamTerminalResponse: Record<string, unknown> | undefined;
	let lastSequence = -1;
	let thrown: unknown;
	// TTFT 取首个语义增量（推理/正文/工具参数）的到达时间。response.created 等包络事件由本端立即转发，
	// 把它算作首字会让每次请求的 TTFT 都接近 0，反而掩盖真实的首字延迟。
	let firstSemanticDeltaAt: Date | undefined;
	let rejectClientAbort: ((error: Error) => void) | undefined;
	const clientAbort = new Promise<never>((_resolve, reject) => {
		rejectClientAbort = reject;
	});
	const onClose = (): void => {
		if (!res.writableEnded && !clientAborted) {
			clientAborted = true;
			rejectClientAbort?.(Object.assign(new Error("client aborted"), { name: "AbortError" }));
		}
	};
	res.once("close", onClose);

	try {
		while (true) {
			const current = await Promise.race([iterator.next(), clientAbort]);
			if (current.done) {
				break;
			}
			if (typeof current.value !== "object" || current.value === null || Array.isArray(current.value)) {
				throw ApiError.unavailable("Provider 返回 malformed Responses stream event");
			}
			const upstreamEvent = structuredClone(current.value) as Record<string, unknown>;
			const event = structuredClone(upstreamEvent);
			if (event["error"] !== undefined && typeof event["type"] !== "string") {
				throw ApiError.unavailable(errorMessage(event["error"]));
			}
			const type = event["type"];
			if (typeof type !== "string" || type.length === 0) {
				throw ApiError.unavailable("Provider 返回缺少 type 的 Responses stream event");
			}
			if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
				upstreamTerminalResponse =
					typeof upstreamEvent["response"] === "object" &&
					upstreamEvent["response"] !== null &&
					!Array.isArray(upstreamEvent["response"])
						? structuredClone(upstreamEvent["response"] as Record<string, unknown>)
						: undefined;
			}
			if (firstSemanticDeltaAt === undefined && isNativeResponsesContentDelta(type)) {
				firstSemanticDeltaAt = new Date();
			}
			restoreNativeResponsesPayload(event, requestBody, toolRegistry);
			if (typeof event["sequence_number"] === "number") {
				lastSequence = Math.max(lastSequence, event["sequence_number"] as number);
			}
			res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
			nativeAccumulator.accumulate(event);
			streamingCheckpointScheduler?.onChunk();
			if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
				terminalType = type;
				terminalResponse =
					typeof event["response"] === "object" && event["response"] !== null && !Array.isArray(event["response"])
						? (event["response"] as Record<string, unknown>)
						: undefined;
				break;
			}
		}
		if (!terminalType || !terminalResponse) {
			throw ApiError.unavailable("Provider Responses stream 未返回终态事件");
		}
		if (!res.writableEnded) {
			res.end();
		}

		const spendInfo = (streamResult as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
		calculateAndSetCost(terminalResponse as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
		const usage = terminalResponse["usage"] as Record<string, unknown> | undefined;
		const loggedResponse = structuredClone(terminalResponse);
		if (typeof loggedResponse["usage"] === "object" && loggedResponse["usage"] !== null && !Array.isArray(loggedResponse["usage"])) {
			delete (loggedResponse["usage"] as Record<string, unknown>)["cost"];
		}
		const terminalError =
			terminalType === "response.failed"
				? new Error(
						errorMessage((terminalResponse["error"] as Record<string, unknown> | undefined)?.["message"] ?? "Responses failed"),
					)
				: undefined;
		await streamingCheckpointScheduler?.dispose();
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				response: loggedResponse,
				usage: usage,
				spendInfo: spendInfo,
				error: terminalError,
				completionStartTime: firstSemanticDeltaAt,
				upstreamLogContext: withUpstreamResponseBody(getUpstreamLogContext(streamResult), upstreamTerminalResponse),
				status: terminalType === "response.failed" ? SpendLogStatus.Failure : SpendLogStatus.Success,
				...getResultModelResolutionMetadata(streamResult),
			}),
		);
	} catch (error) {
		thrown = error;
		await streamingCheckpointScheduler?.dispose();
		if (!clientAborted) {
			const responseError = { code: streamErrorCode(error), message: errorMessage(error) };
			const failedResponse = {
				id: `resp_${randomUUID()}`,
				object: "response",
				created_at: Math.floor(Date.now() / 1000),
				status: "failed",
				error: responseError,
				incomplete_details: null,
				model: model,
				output: [],
				usage: null,
			};
			const failedEvent = {
				type: "response.failed",
				sequence_number: lastSequence + 1,
				response: failedResponse,
			};
			if (!res.writableEnded) {
				res.write(`event: response.failed\ndata: ${JSON.stringify(failedEvent)}\n\n`);
				res.end();
			}
		}
		await lifecycle.finalize(() =>
			recordSpend(db, req, requestId, {
				model: model,
				requestBody: requestBody,
				startTime: startTime,
				error: error,
				completionStartTime: firstSemanticDeltaAt,
				upstreamLogContext: getUpstreamLogContext(streamResult),
				status: SpendLogStatus.Failure,
				...getResultModelResolutionMetadata(streamResult),
			}),
		);
	} finally {
		stopKeepalive();
		res.removeListener("close", onClose);
		if ((thrown !== undefined || terminalType !== undefined) && iterator.return) {
			void iterator.return().catch(() => undefined);
		}
		if (!res.writableEnded && !clientAborted) {
			res.end();
		}
	}
}

function withUpstreamResponseBody(
	context: UpstreamLogContext | undefined,
	body: Record<string, unknown> | undefined,
): UpstreamLogContext | undefined {
	if (!context?.response || body === undefined) {
		return context;
	}
	return {
		...context,
		response: {
			...context.response,
			body: body,
		},
	};
}

async function* modelResponseToSyntheticStream(
	result: Record<string, unknown>,
	skipVisibleText = false,
): AsyncGenerator<Record<string, unknown>> {
	const response = result as unknown as ModelResponse;
	const choice = response.choices?.[0];
	if (!choice) {
		throw ApiError.unavailable("识图 Agent Loop 没有返回 completion choice");
	}
	const base = {
		id: response.id,
		object: "chat.completion.chunk",
		created: response.created,
		model: response.model,
	};
	yield { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] };
	const delta: Record<string, unknown> = {};
	if (!skipVisibleText && typeof choice.message.content === "string" && choice.message.content.length > 0) {
		delta["content"] = choice.message.content;
	}
	if (!skipVisibleText && choice.message.reasoning_content) {
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
	if (Array.isArray(result["_builtinGeneratedImages"])) {
		delta["_builtinGeneratedImages"] = result["_builtinGeneratedImages"];
	}
	if (Object.keys(delta).length > 0) {
		yield { ...base, choices: [{ index: 0, delta: delta, finish_reason: null }] };
	}
	yield {
		...base,
		choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
		...(response.usage ? { usage: response.usage, _usage: response.usage } : {}),
	};
}

/**
 * 原生流既可能是已解析事件，也可能是被任意切块的 SSE 文本；跨块帧需要保留残余缓冲。
 */
function createNativeEventParser(): (raw: unknown) => Record<string, unknown>[] {
	let pending = "";
	return (raw: unknown): Record<string, unknown>[] => {
		if (typeof raw === "object" && raw !== null) {
			return [raw as Record<string, unknown>];
		}
		if (typeof raw !== "string") {
			return [];
		}
		pending += raw;
		const frames = pending.split("\n\n");
		pending = frames.pop() ?? "";
		const events: Record<string, unknown>[] = [];
		for (const frame of frames) {
			const dataLines = frame
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart());
			if (dataLines.length === 0) {
				continue;
			}
			const payload = dataLines.join("\n").trim();
			if (payload.length === 0 || payload === "[DONE]") {
				continue;
			}
			try {
				const parsed = JSON.parse(payload) as unknown;
				if (typeof parsed === "object" && parsed !== null) {
					events.push(parsed as Record<string, unknown>);
				}
			} catch {
				// 非 JSON 帧（注释/心跳）忽略
			}
		}
		return events;
	};
}

/**
 * 原生流既可能是已解析事件，也可能是原始 SSE 文本，统一为事件对象。
 * @param raw - 上游返回的单个事件对象或整段 SSE 文本
 * @returns 解析后的事件对象列表；非 JSON 帧被丢弃
 */
function toNativeResponseEvents(raw: unknown): Record<string, unknown>[] {
	if (typeof raw === "object" && raw !== null) {
		return [raw as Record<string, unknown>];
	}
	if (typeof raw !== "string") {
		return [];
	}
	const events: Record<string, unknown>[] = [];
	for (const frame of raw.split("\n\n")) {
		const dataLines = frame
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart());
		if (dataLines.length === 0) {
			continue;
		}
		const payload = dataLines.join("\n").trim();
		if (payload.length === 0 || payload === "[DONE]") {
			continue;
		}
		try {
			const parsed = JSON.parse(payload) as unknown;
			if (typeof parsed === "object" && parsed !== null) {
				events.push(parsed as Record<string, unknown>);
			}
		} catch {
			// 非 JSON 帧（注释/心跳）忽略
		}
	}
	return events;
}

/**
 * 原生 Responses 事件转内部 chat chunk：只有可见文本需要下行。
 * @param event - 单个原生 Responses 事件
 * @returns 对应 chat chunk；无可见文本增量时返回 undefined
 */
function nativeResponsesEventToChatChunk(event: Record<string, unknown>): Record<string, unknown> | undefined {
	const type = typeof event["type"] === "string" ? event["type"] : "";
	if (type === "response.output_text.delta" && typeof event["delta"] === "string" && event["delta"].length > 0) {
		return { choices: [{ index: 0, delta: { content: event["delta"] }, finish_reason: null }] };
	}
	if (
		(type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") &&
		typeof event["delta"] === "string" &&
		event["delta"].length > 0
	) {
		return { choices: [{ index: 0, delta: { reasoning_content: event["delta"] }, finish_reason: null }] };
	}
	return undefined;
}

/**
 * 能力循环里的工具调用是私有链路，不能出现在下游 SSE 中。
 * @param chunk - 待下行的 chunk
 * @returns 去掉私有工具调用增量后的 chunk
 */
function stripPrivateToolDeltas(chunk: unknown): unknown {
	if (typeof chunk !== "object" || chunk === null) {
		return chunk;
	}
	const record = chunk as Record<string, unknown>;
	if (!Array.isArray(record["choices"])) {
		return chunk;
	}
	return {
		...record,
		choices: (record["choices"] as unknown[]).map((choice) => {
			if (typeof choice !== "object" || choice === null) {
				return choice;
			}
			const entry = choice as Record<string, unknown>;
			const delta = entry["delta"] as Record<string, unknown> | undefined;
			if (delta === undefined || delta === null || delta["tool_calls"] === undefined) {
				return choice;
			}
			return { ...entry, delta: Object.fromEntries(Object.entries(delta).filter(([key]) => key !== "tool_calls")) };
		}),
	};
}

function consumeChatStreamChunk(chunk: unknown, state: ResponsesStreamState, res: Response): void {
	if (typeof chunk !== "object" || chunk === null) {
		throw ApiError.unavailable("Provider 返回 malformed stream event");
	}
	const record = chunk as Record<string, unknown>;
	if (record["error"] !== undefined) {
		throw ApiError.unavailable(errorMessage(record["error"]));
	}
	const choices = record["choices"];
	const chunkUsage = (record["usage"] ?? record["_usage"]) as Usage | undefined;
	if (chunkUsage) {
		state.usage = chunkUsage;
	}
	if (!Array.isArray(choices)) {
		throw ApiError.unavailable("Provider 返回 malformed stream event");
	}
	if (typeof record["model"] === "string") {
		state.model = record["model"];
	}
	for (const choice of choices) {
		if (typeof choice !== "object" || choice === null) {
			throw ApiError.unavailable("Provider 返回 malformed stream choice");
		}
		const delta = (choice as Record<string, unknown>)["delta"] as Record<string, unknown> | undefined;
		const finishReason = (choice as Record<string, unknown>)["finish_reason"];
		if (typeof finishReason === "string") {
			state.finishReason = finishReason;
		}
		if (!delta) {
			continue;
		}
		const reasoningDelta =
			typeof delta["reasoning_content"] === "string" && delta["reasoning_content"].length > 0
				? delta["reasoning_content"]
				: extractThinkingDelta(delta["thinking_blocks"]);
		if (reasoningDelta) {
			state.reasoning += reasoningDelta;
			// 空白增量本身不构成可展示内容：只在已经有真正的文字时才产出思考分区。
			// 注意不能在这里 continue——同一 delta 里可能还带着正文或工具调用，跳过会丢掉它们。
			if (state.reasoning.trim().length > 0) {
				openReasoningItem(state, res);
				writeEvent(res, state, "response.reasoning_text.delta", {
					item_id: state.reasoningItem!.id,
					output_index: state.output.indexOf(state.reasoningItem!),
					content_index: 0,
					delta: reasoningDelta,
				});
			}
		}
		if (typeof delta["content"] === "string" && delta["content"].length > 0) {
			openTextPart(state, res);
			state.text += delta["content"];
			writeEvent(res, state, "response.output_text.delta", {
				item_id: state.messageItem!.id,
				output_index: state.output.indexOf(state.messageItem!),
				content_index: state.textContentIndex!,
				delta: delta["content"],
				logprobs: [],
			});
		}
		if (typeof delta["refusal"] === "string" && delta["refusal"].length > 0) {
			openRefusalPart(state, res);
			state.refusal += delta["refusal"];
			writeEvent(res, state, "response.refusal.delta", {
				item_id: state.messageItem!.id,
				output_index: state.output.indexOf(state.messageItem!),
				content_index: state.refusalContentIndex!,
				delta: delta["refusal"],
			});
		}
		for (const toolDelta of (delta["tool_calls"] as Array<Record<string, unknown>> | undefined) ?? []) {
			consumeToolDelta(toolDelta, state, res);
		}
		for (const image of (delta["_builtinGeneratedImages"] as BuiltinGeneratedImage[] | undefined) ?? []) {
			const item: ResponseOutputItem = {
				id: image.id,
				type: "image_generation_call",
				status: "completed",
				result: image.b64Json,
				output_format: image.outputFormat,
				size: image.size ?? "auto",
				quality: image.quality ?? "auto",
				background: image.background ?? "auto",
			};
			const outputIndex = state.output.length;
			state.output.push(item);
			writeEvent(res, state, "response.output_item.added", { output_index: outputIndex, item: item });
			writeEvent(res, state, "response.image_generation_call.completed", {
				item_id: image.id,
				output_index: outputIndex,
				result: image.b64Json,
			});
			writeEvent(res, state, "response.output_item.done", { output_index: outputIndex, item: item });
		}
	}
}

function extractThinkingDelta(value: unknown): string {
	if (!Array.isArray(value)) {
		return "";
	}
	return value
		.filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
		.map((block) => (typeof block["thinking"] === "string" ? block["thinking"] : ""))
		.join("");
}

function openReasoningItem(state: ResponsesStreamState, res: Response): void {
	if (state.reasoningItem) {
		return;
	}
	const item = buildReasoningItem(state.responseId, state.output.length, "");
	item.status = "in_progress";
	state.reasoningItem = item;
	state.output.push(item);
	writeEvent(res, state, "response.output_item.added", { output_index: state.output.length - 1, item: item });
}

function openMessageItem(state: ResponsesStreamState, res: Response): void {
	if (state.messageItem) {
		return;
	}
	const item = buildMessageItem(state.responseId, state.output.length, "");
	item.status = "in_progress";
	state.messageItem = item;
	state.output.push(item);
	const outputIndex = state.output.length - 1;
	writeEvent(res, state, "response.output_item.added", { output_index: outputIndex, item: item });
}

function openTextPart(state: ResponsesStreamState, res: Response): void {
	openMessageItem(state, res);
	if (state.textContentIndex !== undefined) {
		return;
	}
	state.textContentIndex = state.nextContentIndex++;
	const outputIndex = state.output.indexOf(state.messageItem!);
	writeEvent(res, state, "response.content_part.added", {
		item_id: state.messageItem!.id,
		output_index: outputIndex,
		content_index: state.textContentIndex,
		part: { type: "output_text", annotations: [], logprobs: [], text: "" },
	});
}

function openRefusalPart(state: ResponsesStreamState, res: Response): void {
	openMessageItem(state, res);
	if (state.refusalContentIndex !== undefined) {
		return;
	}
	state.refusalContentIndex = state.nextContentIndex++;
	writeEvent(res, state, "response.content_part.added", {
		item_id: state.messageItem!.id,
		output_index: state.output.indexOf(state.messageItem!),
		content_index: state.refusalContentIndex,
		part: { type: "refusal", refusal: "" },
	});
}

function consumeToolDelta(delta: Record<string, unknown>, state: ResponsesStreamState, res: Response): void {
	const index = typeof delta["index"] === "number" ? delta["index"] : 0;
	const fn = (delta["function"] as Record<string, unknown> | undefined) ?? {};
	let tool = state.tools.get(index);
	if (!tool) {
		const callId = typeof delta["id"] === "string" ? delta["id"] : `call_${randomUUID()}`;
		const itemId = `${state.responseId}_function_${state.output.length}`;
		tool = {
			id: callId,
			name: "",
			arguments: "",
			itemId: itemId,
			outputIndex: state.output.length,
		};
		state.tools.set(index, tool);
		const initialChatName = typeof fn["name"] === "string" ? fn["name"] : "";
		const initialToolName = state.toolRegistry.fromChatName(initialChatName);
		const item: ResponseOutputItem = {
			id: itemId,
			type: "function_call",
			status: "in_progress",
			call_id: callId,
			name: initialToolName.name,
			...(initialToolName.namespace !== undefined ? { namespace: initialToolName.namespace } : {}),
			arguments: "",
		};
		state.output.push(item);
		writeEvent(res, state, "response.output_item.added", { output_index: tool.outputIndex, item: item });
	}
	if (typeof fn["name"] === "string") {
		tool.name += fn["name"];
	}
	if (typeof fn["arguments"] === "string" && fn["arguments"].length > 0) {
		tool.arguments += fn["arguments"];
		writeEvent(res, state, "response.function_call_arguments.delta", {
			item_id: tool.itemId,
			output_index: tool.outputIndex,
			delta: fn["arguments"],
		});
	}
}

function writeCompletedEvents(res: Response, state: ResponsesStreamState): void {
	// reasoning 全程只有空白时没有可展示内容，直接从 output 移除，避免客户端渲染空思考区。
	if (state.reasoningItem && state.reasoning.trim().length === 0) {
		state.output = state.output.filter((entry) => entry !== state.reasoningItem);
		state.reasoningItem = undefined;
	}
	for (let outputIndex = 0; outputIndex < state.output.length; outputIndex++) {
		const item = state.output[outputIndex]!;
		item.status = "completed";
		if (item.type === "reasoning") {
			item.content = [{ type: "reasoning_text", text: state.reasoning }];
			writeEvent(res, state, "response.reasoning_text.done", {
				item_id: item.id,
				output_index: outputIndex,
				content_index: 0,
				text: state.reasoning,
			});
		} else if (item.type === "message") {
			const parts: Array<{ index: number; part: Record<string, unknown> }> = [];
			if (state.textContentIndex !== undefined) {
				const part = { type: "output_text", annotations: [], logprobs: [], text: state.text };
				parts.push({ index: state.textContentIndex, part: part });
				writeEvent(res, state, "response.output_text.done", {
					item_id: item.id,
					output_index: outputIndex,
					content_index: state.textContentIndex,
					text: state.text,
					logprobs: [],
				});
			}
			if (state.refusalContentIndex !== undefined) {
				const part = { type: "refusal", refusal: state.refusal };
				parts.push({ index: state.refusalContentIndex, part: part });
				writeEvent(res, state, "response.refusal.done", {
					item_id: item.id,
					output_index: outputIndex,
					content_index: state.refusalContentIndex,
					refusal: state.refusal,
				});
			}
			item.content = parts.sort((left, right) => left.index - right.index).map(({ part }) => part);
			for (const { index, part } of parts) {
				writeEvent(res, state, "response.content_part.done", {
					item_id: item.id,
					output_index: outputIndex,
					content_index: index,
					part: part,
				});
			}
		} else if (item.type === "function_call") {
			const tool = [...state.tools.values()].find((candidate) => candidate.itemId === item.id);
			if (tool !== undefined) {
				const toolName = state.toolRegistry.fromChatName(tool.name);
				item.name = toolName.name;
				if (toolName.namespace !== undefined) {
					item.namespace = toolName.namespace;
				} else {
					delete item.namespace;
				}
				item.arguments = tool.arguments;
				writeEvent(res, state, "response.function_call_arguments.done", {
					item_id: item.id,
					output_index: outputIndex,
					arguments: tool.arguments,
					name: toolName.name,
					...(toolName.namespace !== undefined ? { namespace: toolName.namespace } : {}),
				});
			}
		}
		// 其余类型（如 image_generation_call）在加入 output 时已是终态，无需再补工具参数。
		writeEvent(res, state, "response.output_item.done", { output_index: outputIndex, item: item });
	}
}

function buildStreamResponse(
	state: ResponsesStreamState,
	request: ResponsesCreateRequest,
	status: StandardResponseObject["status"],
	error: ResponseError | null,
): StandardResponseObject {
	return buildResponseObject({
		id: state.responseId,
		createdAt: state.createdAt,
		status: status,
		error: error,
		instructions: state.instructions,
		model: state.model,
		output: state.output,
		usage: mapResponseUsage(state.usage as unknown as Record<string, unknown> | undefined),
		request: request,
		incompleteDetails: status === "incomplete" ? { reason: "max_output_tokens" } : null,
	});
}

function writeEvent(res: Response, state: ResponsesStreamState, type: string, payload: Record<string, unknown>): void {
	if (state.terminalSent || res.writableEnded) {
		return;
	}
	res.write(`event: ${type}\ndata: ${JSON.stringify({ type: type, sequence_number: state.sequence++, ...payload })}\n\n`);
}

function writeTerminalEvent(
	res: Response,
	state: ResponsesStreamState,
	type: "response.completed" | "response.incomplete" | "response.failed",
	payload: Record<string, unknown>,
): void {
	if (state.terminalSent || res.writableEnded) {
		return;
	}
	writeEvent(res, state, type, payload);
	state.terminalSent = true;
}

async function recordSpend(
	db: DrizzleDb | undefined,
	req: Request,
	requestId: string | undefined,
	context: {
		model: string;
		requestBody: ResponsesCreateRequest;
		startTime: Date;
		response?: unknown;
		usage?: Record<string, unknown>;
		spendInfo?: DeploymentSpendInfo;
		fallbackModels?: string[];
		modelResolutionChain?: import("../router/ModelResolutionTrace").ModelResolutionChainEntry[];
		routingTrace?: import("../router/ModelResolutionTrace").RoutingTraceEntry[];
		attemptedRetries?: number;
		error?: unknown;
		upstreamLogContext?: UpstreamLogContext;
		completionStartTime?: Date;
		status: SpendLogStatus;
	},
): Promise<void> {
	if (!db || !req.auth || !requestId) {
		return;
	}
	try {
		await trackSpendLog(
			db,
			await buildSpendLogFromRequest({
				req: req,
				auth: req.auth,
				requestId: requestId,
				callType: CallType.AResponses,
				model: context.model,
				modelGroup: context.model,
				modelId: context.spendInfo?.modelId,
				customLlmProvider: context.spendInfo?.customLlmProvider,
				apiBase: context.spendInfo?.apiBase,
				customCostPerToken: context.spendInfo?.customCostPerToken,
				deploymentModel: context.spendInfo?.deploymentModel,
				startTime: context.startTime,
				endTime: new Date(),
				completionStartTime: context.completionStartTime,
				messages: context.requestBody.input,
				response: context.response,
				usage: context.usage,
				error: context.error,
				upstreamLogContext: context.upstreamLogContext,
				status: context.status,
				fallbackModels: context.fallbackModels,
				modelResolutionChain: context.modelResolutionChain,
				routingTrace: context.routingTrace,
				attemptedRetries: context.attemptedRetries,
			}),
		);
	} catch (accountingError) {
		logger.error("Responses 花费账务提交失败", { accountingError: accountingError, requestId: requestId });
		try {
			await releaseSpend(db, requestId);
		} catch (releaseError) {
			logger.error("Responses reservation 释放失败", { error: releaseError, requestId: requestId });
		}
		throw accountingError;
	}
}

function copyProviderHeaders(result: Record<string, unknown>, res: Response): void {
	const headers = result["_providerHeaders"];
	if (typeof headers !== "object" || headers === null) {
		return;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string" && isForwardableUpstreamHeader(key) && !res.getHeader(key)) {
			res.setHeader(key, value);
		}
	}
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Record<string, unknown>> {
	return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null) {
		const record = error as Record<string, unknown>;
		if (typeof record["message"] === "string") {
			return record["message"];
		}
	}
	return String(error);
}

function streamErrorCode(error: unknown): string {
	return error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "server_error";
}

function responseStorageNotImplemented(): never {
	throw new ApiError(501, "Responses retrieve/delete 未实现；当前仅支持 create", "not_implemented");
}
