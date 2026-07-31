/**
 * Completions 端点 — 文本补全（传统）
 *
 * 对应 OpenAI 的 /v1/completions 端点（text-davinci 等模型的遗留接口）。
 * 委托 LiteLLM Router 处理路由、重试和降级。
 */

import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { stripInternalFields } from "../core/api/stripInternalFields";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { runCommonChecks } from "../auth/AuthChecks";
import {
	buildSpendLogFromRequest,
	calculateAndSetCost,
	injectResponseCostHeader,
	releaseSpend,
	trackSpendLog,
} from "../spend/SpendTracker";
import { reserveEndpointSpend } from "../spend/SpendReservation";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse } from "../types/openai";
import { getResultModelResolutionMetadata } from "../router/ModelResolutionTrace";

const logger = createModuleLogger("Proxy:Completions");

/**
 * 注册 Completions 路由到 Express Router
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 * @param db - 数据库实例
 */
export function registerCompletionsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter, db: DrizzleDb): void {
	const handler = createCompletionsHandler(litellmRouter, db);

	registerRoute(expressRouter, { method: "post", path: "/v1/completions" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/completions" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/engines/*/completions" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/openai/deployments/*/completions" }, handler);
}

function getPathModel(req: import("express").Request): unknown {
	return req.params.model ?? req.params[0];
}

/**
 * 创建 Completions 请求处理器
 *
 * 将 prompt 包装为单条 user 消息后委托 Router.completion。
 * @param litellmRouter - LiteLLM Router 实例
 * @param db - 数据库实例
 */
function createCompletionsHandler(litellmRouter: LiteLLMRouter, db: DrizzleDb) {
	return async (req: import("express").Request, res: import("express").Response): Promise<unknown> => {
		const model = getPathModel(req) ?? req.body.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}

		const prompt = req.body.prompt;
		if (prompt === undefined) {
			throw ApiError.badRequest("prompt 字段缺失");
		}

		// Router 仍使用 chat message 作为统一入口；原始 prompt 保留给 provider 层对齐 text-completion 协议。
		const promptText = Array.isArray(prompt) ? prompt.join("") : String(prompt);
		const messages = [{ role: "user", content: promptText }];
		const optionalParams: Record<string, unknown> = { ...req.body };
		delete optionalParams.model;
		optionalParams["prompt"] = prompt;

		const startTime = new Date();
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, req, model, req.body, {
			callType: CallType.ACompletion,
			startTime: startTime,
		});
		const requestId = spendReservation?.requestId;
		try {
			spendReservation?.heartbeat?.markProviderStarted();
			if (req.body.stream === true) {
				await handleStreamingCompletion(litellmRouter, model, messages, optionalParams, {
					db: db,
					req: req,
					res: res,
					requestId: requestId,
					startTime: startTime,
				});
				return undefined;
			}

			let providerCompleted = false;
			try {
				const result = await litellmRouter.completion(model, messages, optionalParams);
				providerCompleted = true;
				const completionStartTime = new Date();
				const spendInfo = (result as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
				calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
				const usage = result["usage"] as Record<string, unknown> | undefined;
				if (req.auth && requestId) {
					await trackSpendLog(
						db,
						await buildSpendLogFromRequest({
							req: req,
							auth: req.auth,
							requestId: requestId,
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
							messages: prompt,
							response: result,
							usage: usage,
							status: SpendLogStatus.Success,
							...getResultModelResolutionMetadata(result),
						}),
					);
				}
				if (usage?.["cost"] !== undefined) {
					injectResponseCostHeader(res, usage["cost"] as number);
				}
				copyProviderHeaders(result, res);
				return result;
			} catch (error) {
				if (providerCompleted) {
					throw error;
				}
				await recordProviderFailure({ db: db, req: req, model: model, requestId: requestId, startTime: startTime }, error);
				throw error;
			}
		} finally {
			spendReservation?.heartbeat?.stop();
		}
	};
}

async function handleStreamingCompletion(
	litellmRouter: LiteLLMRouter,
	model: string,
	messages: Array<{ role: string; content: string }>,
	optionalParams: Record<string, unknown>,
	context: {
		db: DrizzleDb;
		req: import("express").Request;
		res: import("express").Response;
		requestId: string | undefined;
		startTime: Date;
	},
): Promise<void> {
	const { db, req, res, requestId, startTime } = context;
	let streamResult: Record<string, unknown>;
	try {
		streamResult = await litellmRouter.completion(model, messages, optionalParams);
	} catch (error) {
		await recordProviderFailure({ db: db, req: req, model: model, requestId: requestId, startTime: startTime }, error);
		throw error;
	}

	const stream = streamResult["stream"];
	if (streamResult["_stream"] !== true || !isAsyncIterable(stream)) {
		const contractError = ApiError.unavailable("Provider 未返回流式响应");
		await recordProviderFailure({ db: db, req: req, model: model, requestId: requestId, startTime: startTime }, contractError);
		throw contractError;
	}

	const iterator = stream[Symbol.asyncIterator]();
	let first: IteratorResult<Record<string, unknown>>;
	try {
		first = await iterator.next();
	} catch (error) {
		await recordProviderFailure({ db: db, req: req, model: model, requestId: requestId, startTime: startTime }, error);
		throw error;
	}

	copyProviderHeaders(streamResult, res);
	res.status(200);
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();

	let usage: Record<string, unknown> | undefined;
	let lastChunk: Record<string, unknown> | undefined;
	try {
		let current = first;
		while (!current.done) {
			lastChunk = current.value;
			const chunkUsage = current.value["usage"];
			if (typeof chunkUsage === "object" && chunkUsage !== null) {
				usage = chunkUsage as Record<string, unknown>;
			}
			res.write(`data: ${JSON.stringify(stripInternalFields(current.value))}\n\n`);
			current = await iterator.next();
		}
		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		await recordProviderFailure({ db: db, req: req, model: model, requestId: requestId, startTime: startTime }, error);
		res.end();
		return;
	}

	if (req.auth && requestId) {
		const spendInfo = (streamResult as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
		try {
			await trackSpendLog(
				db,
				await buildSpendLogFromRequest({
					req: req,
					auth: req.auth,
					requestId: requestId,
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
					messages: req.body.prompt,
					response: lastChunk,
					usage: usage,
					status: SpendLogStatus.Success,
					...getResultModelResolutionMetadata(streamResult),
				}),
			);
		} catch (accountingError) {
			// SSE 已完成，生产 trackSpendLog 会先尝试释放 reservation；此处只能记录账务错误。
			logger.error("流式 Completions 花费账务提交失败", { error: accountingError, requestId: requestId });
		}
	}
}

async function recordProviderFailure(
	context: {
		db: DrizzleDb;
		req: import("express").Request;
		model: string;
		requestId: string | undefined;
		startTime: Date;
	},
	providerError: unknown,
): Promise<void> {
	const { db, req, model, requestId, startTime } = context;
	if (!req.auth || !requestId) {
		return;
	}
	try {
		await trackSpendLog(
			db,
			await buildSpendLogFromRequest({
				req: req,
				auth: req.auth,
				requestId: requestId,
				callType: CallType.ACompletion,
				model: model,
				modelGroup: model,
				startTime: startTime,
				endTime: new Date(),
				messages: req.body.prompt,
				error: providerError,
				status: SpendLogStatus.Failure,
			}),
		);
	} catch (accountingError) {
		logger.error("Provider 失败后的 Completions 花费账务提交失败", {
			accountingError: accountingError,
			requestId: requestId,
		});
		try {
			await releaseSpend(db, requestId);
		} catch (releaseError) {
			logger.error("Provider 失败后释放 Completions reservation 失败", { error: releaseError, requestId: requestId });
		}
	}
}

function copyProviderHeaders(result: Record<string, unknown>, res: import("express").Response): void {
	const providerHeaders = result["_providerHeaders"];
	if (typeof providerHeaders !== "object" || providerHeaders === null) {
		return;
	}
	for (const [key, value] of Object.entries(providerHeaders)) {
		if (typeof value === "string" && !res.getHeader(key)) {
			res.setHeader(key, value);
		}
	}
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Record<string, unknown>> {
	return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
