/**
 * 订阅运行时的非标准端点。
 *
 * 这些路径原先由 Go 宿主直接转发：Responses compact、Codex alpha search、
 * xAI 视频/语音以及 live/realtime 的 HTTP 建连。这里只保留路由选择与桥接，
 * 具体上游路径、鉴权和协议由 Provider 适配器负责。
 */

import type { Request as ExpressRequest, Response as ExpressResponse, Router as ExpressRouter } from "express";
import { ApiError } from "../../core/api/ApiError";
import { runCommonChecks } from "../../auth/AuthChecks";
import { registerRoute } from "../../core/api/registerRoute";
import { executeProviderRequest } from "../../router/ProviderRequestExecutor";
import type { Router } from "../../router/Router";
import { buildDeploymentSpendInfo } from "../../router/RouterSpendInfo";
import { buildSpendLogFromRequest, calculateAndSetCost, getOrCreateSpendRequestId } from "../../spend/SpendTracker";
import { queueSpendLog } from "../../spend/SpendSettlementQueue";
import type { DrizzleDb } from "../../core/db/Database";
import type { Deployment } from "../../types/router";
import type { ModelResponse } from "../../types/openai";
import { CallType, SpendLogStatus } from "../../types/spend";
import { createModuleLogger } from "../../core/utils/logger";

const logger = createModuleLogger("Subscription:Special");
import { SUBSCRIPTION_PROVIDER_TO_SOURCE } from "./types";
import type { SubscriptionOperation, SubscriptionSource } from "./types";
import { subscriptionBridgeUrl } from "./bridge";

/** 单次转发的结果。 */
interface DispatchResult {
	/** 上游返回体；二进制响应时为 undefined。 */
	readonly body: unknown;
	/** 上游状态码。 */
	readonly status: number;
	/** 原始响应；二进制或流式响应直接回传。 */
	readonly response: Response;
	/** 实际命中的 deployment，用于账务归因。 */
	readonly deployment: Deployment;
}

/**
 * 从 deployment 上读取订阅来源。
 * @param deployment - 命中的 deployment
 */
function deploymentSource(deployment: { litellm_params: Record<string, unknown> }): SubscriptionSource | undefined {
	const provider = deployment.litellm_params["custom_llm_provider"];
	if (typeof provider !== "string") {
		return undefined;
	}
	return (SUBSCRIPTION_PROVIDER_TO_SOURCE as Record<string, SubscriptionSource | undefined>)[provider];
}

/**
 * 通过订阅桥执行一次特殊端点请求。
 * @param router - 业务 Router
 * @param operation - 订阅操作
 * @param model - 模型 ID
 * @param body - 请求体
 * @param headers - 透传请求头
 * @param options - 流式/目标路径覆盖
 */
async function dispatch(
	router: Router,
	operation: SubscriptionOperation,
	model: string,
	body: Record<string, unknown>,
	headers: Record<string, string>,
	options: { readonly stream?: boolean; readonly bridgeOperation?: string } = {},
): Promise<DispatchResult> {
	const selected = router.getAvailableDeployment(model);
	if (!selected) {
		throw ApiError.badRequest(`没有可用的 deployment：${model}`);
	}
	const source = deploymentSource(selected.deployment);
	if (!source) {
		throw ApiError.badRequest(`该端点仅支持订阅模型：${model}`);
	}
	try {
		const stream = options.stream === true;
		const binary = operation === "speech" || operation === "live" || operation === "realtime" || stream;
		const execution = await executeProviderRequest(
			{
				url: subscriptionBridgeUrl(source, options.bridgeOperation ?? operation),
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: body,
				model: model,
				stream: stream,
			},
			binary ? { readJson: false } : undefined,
		);
		if (!execution.response.ok) {
			const text = execution.body === undefined ? "" : JSON.stringify(execution.body);
			throw new ApiError(execution.response.status, text.slice(0, 500));
		}
		router.recordDeploymentSuccess(selected.deployment);
		if (stream) {
			return {
				body: undefined,
				status: execution.response.status,
				response: execution.response,
				deployment: selected.deployment,
			};
		}
		const contentType = execution.response.headers.get("content-type") ?? "";
		if (execution.body !== undefined) {
			return {
				body: execution.body,
				status: execution.response.status,
				response: execution.response,
				deployment: selected.deployment,
			};
		}
		if (contentType.includes("application/json")) {
			return {
				body: (await execution.response.json()) as unknown,
				status: execution.response.status,
				response: execution.response,
				deployment: selected.deployment,
			};
		}
		return {
			body: undefined,
			status: execution.response.status,
			response: execution.response,
			deployment: selected.deployment,
		};
	} catch (error) {
		router.recordDeploymentFailure(selected.deployment, error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}

/**
 * 把未知值读取为对象。
 * @param value - 任意值
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 把 Gemini usageMetadata 转成 SpendTracker 认识的 chat usage。
 * @param value - usageMetadata
 */
function geminiUsage(value: unknown): Record<string, unknown> | undefined {
	const meta = asRecord(value);
	if (!meta) {
		return undefined;
	}
	const prompt = typeof meta["promptTokenCount"] === "number" ? meta["promptTokenCount"] : 0;
	const candidates = typeof meta["candidatesTokenCount"] === "number" ? meta["candidatesTokenCount"] : 0;
	const thoughts = typeof meta["thoughtsTokenCount"] === "number" ? meta["thoughtsTokenCount"] : 0;
	const total = typeof meta["totalTokenCount"] === "number" ? meta["totalTokenCount"] : prompt + candidates + thoughts;
	if (prompt + candidates + thoughts + total === 0) {
		return undefined;
	}
	const cached = typeof meta["cachedContentTokenCount"] === "number" ? meta["cachedContentTokenCount"] : 0;
	const completion = candidates + thoughts;
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: total,
		...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
		...(thoughts > 0 ? { completion_tokens_details: { reasoning_tokens: thoughts } } : {}),
	};
}

/**
 * 从 Gemini SSE 文本中取最后一个 usageMetadata。
 * @param text - 完整 SSE 文本
 */
function geminiStreamUsage(text: string): Record<string, unknown> | undefined {
	let usage: Record<string, unknown> | undefined;
	for (const block of text.split(/\r?\n\r?\n/)) {
		for (const line of block.split(/\r?\n/)) {
			if (!line.startsWith("data:")) {
				continue;
			}
			const payload = line.slice(5).trim();
			if (!payload || payload === "[DONE]") {
				continue;
			}
			try {
				const parsed = asRecord(JSON.parse(payload) as unknown);
				const meta = parsed ? asRecord(parsed["usageMetadata"]) : undefined;
				if (meta) {
					usage = meta;
				}
			} catch {
				// 上游可能发送非 JSON 的 keepalive 行；账务只关心可解析的 usage。
			}
		}
	}
	return usage;
}

/** Gemini 账务输入。 */
interface GeminiSpendInput {
	/** 数据库；未启用时为空。 */
	readonly db: DrizzleDb | undefined;
	/** 客户端请求。 */
	readonly req: ExpressRequest;
	/** 订阅桥结果。 */
	readonly result: DispatchResult;
	/** 公开模型名。 */
	readonly model: string;
	/** Gemini 请求体。 */
	readonly requestBody: Record<string, unknown>;
	/** 请求开始时间。 */
	readonly startedAt: Date;
	/** Gemini usageMetadata。 */
	readonly usageMetadata: unknown;
	/** 非流式响应体。 */
	readonly responseBody?: unknown;
}

/**
 * 记录 Gemini 入口的花费；失败只记日志，不影响已经返回给客户端的响应。
 * @param input - 账务输入
 */
async function recordGeminiSpend(input: GeminiSpendInput): Promise<void> {
	const { db, req, result, model, requestBody, startedAt, usageMetadata, responseBody } = input;
	if (!db || !req.auth) {
		return;
	}
	const usage = geminiUsage(usageMetadata);
	const source = deploymentSource(result.deployment);
	if (!usage || !source) {
		return;
	}
	const spendInfo = buildDeploymentSpendInfo(result.deployment, subscriptionBridgeUrl(source, "gemini"));
	const costResponse = { usage: usage, _spendInfo: spendInfo } as unknown as ModelResponse;
	calculateAndSetCost(costResponse, model, spendInfo.customCostPerToken);
	try {
		const requestId = getOrCreateSpendRequestId(req);
		await queueSpendLog(
			db,
			await buildSpendLogFromRequest({
				req: req,
				auth: req.auth,
				requestId: requestId,
				callType: CallType.ACompletion,
				model: model,
				modelGroup: model,
				modelId: spendInfo.modelId,
				customLlmProvider: spendInfo.customLlmProvider,
				apiBase: spendInfo.apiBase,
				customCostPerToken: spendInfo.customCostPerToken,
				deploymentModel: spendInfo.deploymentModel,
				startTime: startedAt,
				endTime: new Date(),
				messages: requestBody["contents"] ?? requestBody,
				response: responseBody,
				usage: usage,
				status: SpendLogStatus.Success,
			}),
		);
	} catch (error) {
		logger.warn("Gemini 花费账务提交失败", { error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * 把 OpenAI/Responses 风格 usage 规整为 SpendTracker 认得的 chat usage。
 * @param value - 响应中的 usage
 */
function openAiUsage(value: unknown): Record<string, unknown> | undefined {
	const usage = asRecord(value);
	if (!usage) {
		return undefined;
	}
	const prompt =
		typeof usage["prompt_tokens"] === "number"
			? usage["prompt_tokens"]
			: typeof usage["input_tokens"] === "number"
				? usage["input_tokens"]
				: 0;
	const completion =
		typeof usage["completion_tokens"] === "number"
			? usage["completion_tokens"]
			: typeof usage["output_tokens"] === "number"
				? usage["output_tokens"]
				: 0;
	const total = typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : prompt + completion;
	if (prompt + completion + total === 0) {
		return undefined;
	}
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: total,
		...(asRecord(usage["prompt_tokens_details"]) ? { prompt_tokens_details: usage["prompt_tokens_details"] } : {}),
		...(asRecord(usage["completion_tokens_details"]) ? { completion_tokens_details: usage["completion_tokens_details"] } : {}),
	};
}

/**
 * 记录特殊订阅端点的花费；没有 usage 时按零 token 记账，保证请求可归属。
 * @param input - 账务输入
 */
async function recordSpecialSpend(input: {
	readonly db: DrizzleDb | undefined;
	readonly req: ExpressRequest;
	readonly result: DispatchResult;
	readonly model: string;
	readonly requestBody: Record<string, unknown>;
	readonly startedAt: Date;
	readonly responseBody?: unknown;
}): Promise<void> {
	const { db, req, result, model, requestBody, startedAt, responseBody } = input;
	if (!db || !req.auth) {
		return;
	}
	const source = deploymentSource(result.deployment);
	if (!source) {
		return;
	}
	const body = asRecord(responseBody);
	const usage = openAiUsage(body?.["usage"]) ??
		geminiUsage(body?.["usageMetadata"]) ??
		openAiUsage(body?.["response"] && asRecord(body["response"])?.["usage"]) ?? {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0,
		};
	const spendInfo = buildDeploymentSpendInfo(result.deployment, subscriptionBridgeUrl(source, "responses"));
	const costResponse = { usage: usage, _spendInfo: spendInfo } as unknown as ModelResponse;
	calculateAndSetCost(costResponse, model, spendInfo.customCostPerToken);
	try {
		const requestId = getOrCreateSpendRequestId(req);
		await queueSpendLog(
			db,
			await buildSpendLogFromRequest({
				req: req,
				auth: req.auth,
				requestId: requestId,
				callType: CallType.ACompletion,
				model: model,
				modelGroup: model,
				modelId: spendInfo.modelId,
				customLlmProvider: spendInfo.customLlmProvider,
				apiBase: spendInfo.apiBase,
				customCostPerToken: spendInfo.customCostPerToken,
				deploymentModel: spendInfo.deploymentModel,
				startTime: startedAt,
				endTime: new Date(),
				messages: requestBody,
				response: responseBody ?? {},
				usage: usage,
				status: SpendLogStatus.Success,
			}),
		);
	} catch (error) {
		logger.warn("特殊订阅端点花费提交失败", { error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * 把 Gemini SSE 原样写给客户端，并在客户端断开时取消上游读取。
 * @param req - 客户端请求
 * @param res - 客户端响应
 * @param result - 订阅桥返回的流式响应
 */
async function pipeGeminiStream(
	req: ExpressRequest,
	res: ExpressResponse,
	result: DispatchResult,
): Promise<Record<string, unknown> | undefined> {
	res.status(result.status);
	res.setHeader("content-type", "text/event-stream; charset=utf-8");
	res.setHeader("cache-control", "no-cache");
	res.flushHeaders();
	const body = result.response.body;
	if (!body) {
		res.end();
		return undefined;
	}
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	const abort = (): void => {
		if (!res.writableEnded) {
			void reader.cancel().catch(() => undefined);
		}
	};
	res.on("close", abort);
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) {
				break;
			}
			text += decoder.decode(next.value, { stream: true });
			if (!res.write(Buffer.from(next.value))) {
				await new Promise<void>((resolve) => res.once("drain", resolve));
			}
		}
		text += decoder.decode();
		res.end();
		return geminiStreamUsage(text);
	} finally {
		res.off("close", abort);
		reader.releaseLock();
	}
}

/**
 * 执行 Gemini generateContent / streamGenerateContent。
 * @param router - 业务 Router
 * @param db - 数据库
 * @param req - 客户端请求
 * @param res - 客户端响应
 */
async function handleGeminiGenerate(
	router: Router,
	db: DrizzleDb | undefined,
	req: ExpressRequest,
	res: ExpressResponse,
): Promise<unknown> {
	const raw = decodeURIComponent(String(req.params[0] ?? ""));
	const colon = raw.lastIndexOf(":");
	const model = (colon > 0 ? raw.slice(0, colon) : raw).replace(/^models\//, "");
	const action = colon > 0 ? raw.slice(colon + 1) : "";
	if (!model) {
		throw ApiError.badRequest("缺少 Gemini 模型");
	}
	if (action !== "generateContent" && action !== "streamGenerateContent") {
		throw ApiError.badRequest(`不支持的 Gemini 操作：${action || "空"}`);
	}
	const startedAt = new Date();
	const rawBody = (req.body ?? {}) as Record<string, unknown>;
	const body = { ...rawBody, model: model };
	if (req.auth) {
		runCommonChecks(req.auth, model);
	}
	const stream = action === "streamGenerateContent" || req.query["alt"] === "sse";
	const headers: Record<string, string> = {};
	for (const name of ["x-request-id"]) {
		const value = req.headers[name];
		if (typeof value === "string") {
			headers[name] = value;
		}
	}
	const result = await dispatch(router, "chat", model, body, headers, { stream: stream, bridgeOperation: "gemini" });
	if (!stream) {
		await recordGeminiSpend({
			db: db,
			req: req,
			result: result,
			model: model,
			requestBody: rawBody,
			startedAt: startedAt,
			usageMetadata: asRecord(result.body)?.["usageMetadata"],
			responseBody: result.body,
		});
		return result.body;
	}
	const usageMetadata = await pipeGeminiStream(req, res, result);
	await recordGeminiSpend({
		db: db,
		req: req,
		result: result,
		model: model,
		requestBody: rawBody,
		startedAt: startedAt,
		usageMetadata: usageMetadata,
	});
	return undefined;
}

/**
 * 构造 Gemini 模型目录；只暴露 Antigravity 来源，避免把非 Gemini 上游伪装成 Gemini 模型。
 * @param router - 业务 Router
 */
function geminiModels(router: Router): { models: Record<string, unknown>[] } {
	const seen = new Set<string>();
	const models: Record<string, unknown>[] = [];
	for (const deployment of router.getDeployments()) {
		if (deploymentSource(deployment) !== "antigravity" || seen.has(deployment.model_name)) {
			continue;
		}
		seen.add(deployment.model_name);
		models.push({
			name: `models/${deployment.model_name}`,
			displayName: deployment.model_name,
			description: deployment.model_name,
			supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
		});
	}
	return { models: models };
}

/**
 * 在已配置 deployment 中找指定来源、模型名包含关键字的第一项。
 * @param router - 业务 Router
 * @param source - 订阅来源
 * @param keyword - 模型名关键字
 */
function findSourceModel(router: Router, source: SubscriptionSource, keyword: string): string | undefined {
	for (const deployment of router.getDeployments()) {
		if (deploymentSource(deployment) === source && deployment.model_name.toLowerCase().includes(keyword)) {
			return deployment.model_name;
		}
	}
	return undefined;
}

/**
 * 解析请求里的媒体模型；显式模型必须能路由到对应来源。
 * @param router - 业务 Router
 * @param requested - 显式模型或空
 * @param source - 要求来源
 * @param keyword - 无显式模型时的模型名关键字
 * @param operation - 操作名，仅用于错误信息
 * @throws {ApiError} 模型不可路由时抛出
 */
function resolveMediaModel(
	router: Router,
	requested: string | undefined,
	source: SubscriptionSource,
	keyword: string,
	operation: string,
): string {
	if (requested) {
		const selected = router.getAvailableDeployment(requested);
		if (!selected || deploymentSource(selected.deployment) !== source) {
			throw ApiError.badRequest(`${operation} 模型不可用：${requested}`);
		}
		return requested;
	}
	const fallback = findSourceModel(router, source, keyword);
	if (!fallback) {
		throw ApiError.badRequest(`${operation} 需要显式 model，或先配置一个 ${source} 的 ${keyword} deployment`);
	}
	return fallback;
}

/**
 * 把 xAI 视频任务响应映射为 OpenAI Videos API 形状。
 * @param requestId - 视频 ID
 * @param body - xAI 响应
 * @param fallbackModel - 响应缺少 model 时的回退
 */
function openAiVideoResponse(requestId: string, body: Record<string, unknown>, fallbackModel: string): Record<string, unknown> {
	const output: Record<string, unknown> = { object: "video", id: requestId };
	const model = body["model"];
	output["model"] = typeof model === "string" && model.trim() ? model : fallbackModel;
	for (const field of ["created_at", "completed_at", "expires_at", "prompt", "remixed_from_video_id", "size"]) {
		if (body[field] !== undefined) {
			output[field] = body[field];
		}
	}
	const rawStatus = typeof body["status"] === "string" ? body["status"].toLowerCase() : "";
	const status = ["queued", "pending"].includes(rawStatus)
		? "queued"
		: ["in_progress", "processing", "running"].includes(rawStatus)
			? "in_progress"
			: ["completed", "done", "succeeded", "success"].includes(rawStatus)
				? "completed"
				: ["failed", "error", "expired", "cancelled", "canceled"].includes(rawStatus)
					? "failed"
					: undefined;
	if (status) {
		output["status"] = status;
	}
	if (body["progress"] !== undefined) {
		output["progress"] = body["progress"];
	}
	const video = asRecord(body["video"]);
	const seconds = body["seconds"] ?? video?.["duration"];
	if (seconds !== undefined) {
		output["seconds"] = String(seconds);
	}
	const videoUrl = typeof video?.["url"] === "string" ? video["url"] : undefined;
	if (videoUrl) {
		output["video_url"] = videoUrl;
	}
	const error = body["error"];
	if (error !== undefined) {
		output["status"] = "failed";
		output["progress"] = output["progress"] ?? 0;
		const record = asRecord(error);
		output["error"] = {
			code:
				(typeof record?.["code"] === "string" ? record["code"] : undefined) ??
				(typeof body["code"] === "string" ? body["code"] : "video_generation_failed"),
			message:
				typeof record?.["message"] === "string" ? record["message"] : typeof error === "string" ? error : "Video generation failed",
		};
	}
	return output;
}

/**
 * 查询 xAI 视频任务。
 * @param router - 业务 Router
 * @param req - 客户端请求
 */
async function retrieveXaiVideo(router: Router, req: ExpressRequest): Promise<Record<string, unknown>> {
	const requestId = String(req.params["request_id"] ?? req.params["video_id"] ?? "").trim();
	if (!requestId) {
		throw ApiError.badRequest("缺少视频 request_id");
	}
	const queryModel = Array.isArray(req.query["model"]) ? req.query["model"][0] : req.query["model"];
	const model = resolveMediaModel(router, typeof queryModel === "string" ? queryModel : undefined, "xai", "video", "视频查询");
	const result = await dispatch(router, "videos", model, { model: model, request_id: requestId }, {});
	const body = asRecord(result.body);
	if (!body) {
		throw ApiError.unavailable("xAI 视频查询返回了非 JSON 响应");
	}
	return openAiVideoResponse(requestId, body, model);
}

/**
 * 下载 xAI 视频内容。
 * @param router - 业务 Router
 * @param req - 客户端请求
 * @param res - 客户端响应
 */
async function downloadXaiVideo(router: Router, req: ExpressRequest, res: ExpressResponse): Promise<void> {
	const requestId = String(req.params["request_id"] ?? req.params["video_id"] ?? "").trim();
	if (!requestId) {
		throw ApiError.badRequest("缺少视频 video_id");
	}
	const queryModel = Array.isArray(req.query["model"]) ? req.query["model"][0] : req.query["model"];
	const model = resolveMediaModel(router, typeof queryModel === "string" ? queryModel : undefined, "xai", "video", "视频下载");
	const result = await dispatch(router, "videos", model, { model: model, request_id: requestId }, {});
	const body = asRecord(result.body);
	const url = typeof asRecord(body?.["video"])?.["url"] === "string" ? (asRecord(body?.["video"])?.["url"] as string) : "";
	if (!url || !/^https?:\/\//i.test(url)) {
		throw ApiError.unavailable("xAI 视频响应缺少有效的 video.url");
	}
	const content = await fetch(url);
	if (!content.ok) {
		throw new ApiError(content.status, `视频内容下载失败 (${content.status})`);
	}
	const contentType = content.headers.get("content-type");
	if (contentType) {
		res.setHeader("content-type", contentType);
	}
	const length = content.headers.get("content-length");
	if (length) {
		res.setHeader("content-length", length);
	}
	res.status(content.status).end(Buffer.from(await content.arrayBuffer()));
}

/**
 * Gemini countTokens：只支持能原生或经协议翻译计数的来源。
 * @param router - 业务 Router
 * @param req - 客户端请求
 */
async function handleGeminiCountTokens(router: Router, req: ExpressRequest): Promise<Record<string, unknown>> {
	const raw = String(req.params[0] ?? "");
	const colon = raw.lastIndexOf(":");
	const action = colon >= 0 ? raw.slice(colon + 1) : "";
	const model = colon >= 0 ? raw.slice(0, colon).replace(/^models\//, "") : "";
	if (action !== "countTokens" || !model) {
		throw ApiError.notFound("未找到 Gemini countTokens 端点");
	}
	const selected = router.getAvailableDeployment(model);
	const source = selected ? deploymentSource(selected.deployment) : undefined;
	if (!source || (source !== "codex" && source !== "antigravity")) {
		throw ApiError.badRequest(`模型 ${model} 的订阅来源不支持 Gemini countTokens`);
	}
	const body = { ...((req.body ?? {}) as Record<string, unknown>), model: model };
	const result = await dispatch(router, "count_tokens", model, body, {}, { bridgeOperation: "gemini/count_tokens" });
	const responseBody = asRecord(result.body);
	const total =
		typeof responseBody?.["total_tokens"] === "number"
			? responseBody["total_tokens"]
			: typeof responseBody?.["input_tokens"] === "number"
				? responseBody["input_tokens"]
				: 0;
	return { totalTokens: total };
}

/**
 * 注册订阅特殊端点。
 * @param express - 管理/代理 router
 * @param router - 业务 Router
 * @param db - 数据库
 */
export function registerSubscriptionSpecialRoutes(express: ExpressRouter, router: Router, db?: DrizzleDb): void {
	const post = (
		path: string,
		operation: SubscriptionOperation,
		fallbackModel?: (router: Router) => string | undefined,
		videoAction?: string,
	): void => {
		const requestModel = (req: ExpressRequest): string => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const explicit = typeof body["model"] === "string" ? body["model"] : "";
			return explicit || fallbackModel?.(router) || "";
		};
		registerRoute(
			express,
			{
				method: "post",
				path: path,
				matches: (req) => {
					const model = requestModel(req);
					if (!model) {
						return false;
					}
					const selected = router.getAvailableDeployment(model);
					return selected !== null && deploymentSource(selected.deployment) !== undefined;
				},
			},
			async (req, res) => {
				const body = (req.body ?? {}) as Record<string, unknown>;
				const model = requestModel(req);
				if (!model) {
					throw ApiError.badRequest("缺少 model 字段");
				}
				const requestBody = typeof body["model"] === "string" ? body : { ...body, model: model };
				if (req.auth) {
					runCommonChecks(req.auth, model);
				}
				const headers: Record<string, string> = {};
				if (videoAction) {
					headers["x-litellm-video-action"] = videoAction;
				}
				for (const name of ["openai-beta", "anthropic-version", "anthropic-beta", "x-request-id"]) {
					const value = req.headers[name];
					if (typeof value === "string") {
						headers[name] = value;
					}
				}
				const startedAt = new Date();
				const result = await dispatch(router, operation, model, requestBody, headers);
				await recordSpecialSpend({
					db: db,
					req: req,
					result: result,
					model: model,
					requestBody: requestBody,
					startedAt: startedAt,
					responseBody: result.body,
				});
				if (result.body === undefined) {
					const contentType = result.response.headers.get("content-type");
					if (contentType) {
						res.setHeader("content-type", contentType);
					}
					res.status(result.status).end(Buffer.from(await result.response.arrayBuffer()));
					return undefined;
				}
				return result.body;
			},
		);
	};

	registerRoute(express, { method: "get", path: "/v1/videos/:request_id" }, (req) => retrieveXaiVideo(router, req));
	registerRoute(express, { method: "get", path: "/openai/v1/videos/:video_id" }, (req) => retrieveXaiVideo(router, req));
	registerRoute(express, { method: "get", path: "/v1/videos/:request_id/content" }, (req, res) => downloadXaiVideo(router, req, res));
	registerRoute(express, { method: "get", path: "/openai/v1/videos/:video_id/content" }, (req, res) =>
		downloadXaiVideo(router, req, res),
	);
	post("/v1/responses/compact", "compact");
	post("/backend-api/codex/responses/compact", "compact");
	post("/v1/alpha/search", "alpha.search");
	post("/backend-api/codex/alpha/search", "alpha.search");
	post("/v1/videos", "videos", undefined, "generations");
	post("/v1/videos/generations", "videos", undefined, "generations");
	post("/v1/videos/edits", "videos", undefined, "edits");
	post("/v1/videos/extensions", "videos", undefined, "extensions");
	post("/openai/v1/videos", "videos", undefined, "generations");
	post("/openai/v1/videos/generations", "videos", undefined, "generations");
	post("/openai/v1/videos/edits", "videos", undefined, "edits");
	post("/openai/v1/videos/extensions", "videos", undefined, "extensions");
	const speechFallback = (router: Router): string | undefined => findSourceModel(router, "xai", "tts");
	post("/v1/tts", "speech", speechFallback);
	post("/v1/audio/speech", "speech", speechFallback);
	post("/v1/live", "live");
	post("/v1/realtime/calls", "realtime");
	registerRoute(express, { method: "get", path: "/v1beta/models" }, () => geminiModels(router));
	registerRoute(express, { method: "get", path: "/v1beta/models/*" }, (req) => {
		const action = decodeURIComponent(String(req.params[0] ?? "")).replace(/^models\//, "");
		const model = geminiModels(router).models.find((item) => item["name"] === `models/${action}`);
		if (!model) {
			throw new ApiError(404, "Not Found");
		}
		return model;
	});
	registerRoute(
		express,
		{
			method: "post",
			path: "/v1beta/models/*",
			matches: (req) => String(req.params[0] ?? "").endsWith(":countTokens"),
		},
		(req) => handleGeminiCountTokens(router, req),
	);
	registerRoute(
		express,
		{
			method: "post",
			path: "/v1beta/models/*",
			matches: (req) => {
				const raw = String(req.params[0] ?? "");
				const model = (raw.split(":").at(0) ?? "").replace(/^models\//, "");
				if (!model) {
					return false;
				}
				const selected = router.getAvailableDeployment(model);
				return selected !== null && deploymentSource(selected.deployment) !== undefined;
			},
		},
		(req, res) => handleGeminiGenerate(router, db, req, res),
	);
}
