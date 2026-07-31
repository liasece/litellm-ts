/**
 * Embeddings 端点 — 将 /v1/embeddings 请求代理到目标 Provider
 *
 * 类似 Chat Completions 但专用于文本嵌入。
 * 支持标准 OpenAI Embeddings API 格式的输入。
 */

import type { Response, Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { EmbeddingResponse } from "../types/embedding";
import { runCommonChecks } from "../auth/AuthChecks";
import type { DrizzleDb } from "../core/db/Database";
import {
	buildSpendLogFromRequest,
	calculateAndSetCost,
	injectResponseCostHeader,
	releaseSpend,
	trackSpendLog,
} from "../spend/SpendTracker";
import { reserveEndpointSpend } from "../spend/SpendReservation";
import { extractDeploymentCustomCost } from "../router/RouterSpendInfo";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse } from "../types/openai";
import { executeProviderRequest } from "../router/ProviderRequestExecutor";
import { createModuleLogger } from "../core/utils/logger";
import {
	appendModelResolutionTrace,
	copyModelResolutionChain,
	createModelResolutionTraceCollector,
} from "../router/ModelResolutionTrace";

const logger = createModuleLogger("Proxy:Embeddings");

/**
 * 注册 Embeddings 路由到 Express Router
 *
 * 覆盖以下路径：
 * - POST /v1/embeddings（标准 OpenAI）
 * - POST /embeddings（简写）
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 * @param db - Drizzle 数据库实例；传入时记录 SpendLogs
 */
export function registerEmbeddingsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter, db?: DrizzleDb): void {
	const handler = createEmbeddingsHandler(litellmRouter, db);

	registerRoute(expressRouter, { method: "post", path: "/v1/embeddings" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/embeddings" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/engines/*/embeddings" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/openai/deployments/*/embeddings" }, handler);
}

function getPathModel(req: import("express").Request): unknown {
	return req.params.model ?? req.params[0];
}

/**
 * 创建 Embeddings 请求处理器
 * @param litellmRouter - LiteLLM Router 实例
 * @param db - Drizzle 数据库实例；传入时记录 SpendLogs
 */
function createEmbeddingsHandler(litellmRouter: LiteLLMRouter, db: DrizzleDb | undefined) {
	return async (req: import("express").Request, res: Response): Promise<EmbeddingResponse> => {
		const model = getPathModel(req) ?? req.body.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}

		// 授权检查
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}

		const input = req.body.input;
		if (!input) {
			throw ApiError.badRequest("input 字段缺失");
		}

		const optionalParams: Record<string, unknown> = { ...req.body };
		delete optionalParams.model;
		delete optionalParams.input;

		const startTime = new Date();
		const auth = req.auth;
		const modelResolutionTrace = createModelResolutionTraceCollector();
		appendModelResolutionTrace(modelResolutionTrace, 0, litellmRouter.resolveModelGroupWithTrace(model));

		// 部署选择不调用上游；reservation 随后覆盖当前组与所有 fallback deployment。
		const candidate = litellmRouter.getAvailableDeployment(model);
		if (!candidate) {
			throw ApiError.noDeploymentsAvailable(model, litellmRouter.getNoAvailableDeploymentInfo(model));
		}
		const { deployment, provider } = candidate;
		if (provider.transformEmbeddingRequest === undefined) {
			throw ApiError.badRequest(`Provider ${deployment.litellm_params.custom_llm_provider ?? "unknown"} does not support embeddings`);
		}
		const customCost = extractDeploymentCustomCost(deployment);
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, req, model, req.body, {
			callType: CallType.AEmbedding,
			startTime: startTime,
		});
		const requestId = spendReservation?.requestId;

		let providerCompleted = false;
		try {
			const mergedParams: Record<string, unknown> = { ...deployment.litellm_params, ...optionalParams };
			const providerReq = provider.transformEmbeddingRequest(deployment.litellm_params.model, input, mergedParams);
			const requestWithHeaders = {
				...providerReq,
				headers: { ...providerReq.headers, ...deployment.litellm_params.extra_headers },
			};
			const timeoutSec = deployment.litellm_params.timeout;
			spendReservation?.heartbeat?.markProviderStarted();
			const execution = await executeProviderRequest(requestWithHeaders, {
				timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
				readJson: true,
			});
			if (!execution.response.ok) {
				throw new ApiError(execution.response.status, `Provider 返回错误: ${JSON.stringify(execution.body ?? {})}`);
			}
			providerCompleted = true;

			const rawBody = execution.body as EmbeddingResponse;
			calculateAndSetCost(rawBody as unknown as ModelResponse, model, customCost);
			const usage = (rawBody as unknown as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
			if (usage && usage["cost"] !== undefined) {
				injectResponseCostHeader(res, usage["cost"] as number);
			}
			if (db && auth && requestId) {
				await trackSpendLog(
					db,
					await buildSpendLogFromRequest({
						req: req,
						auth: auth,
						requestId: requestId,
						callType: CallType.AEmbedding,
						model: model,
						modelGroup: deployment.model_name,
						modelId: deployment.model_info?.id,
						customLlmProvider: deployment.litellm_params.custom_llm_provider,
						apiBase: deployment.litellm_params.api_base,
						customCostPerToken: customCost,
						deploymentModel: deployment.litellm_params.model,
						startTime: startTime,
						endTime: new Date(),
						messages: input,
						response: rawBody,
						usage: usage,
						status: SpendLogStatus.Success,
						fallbackModels: [model],
						modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
						attemptedRetries: 0,
					}),
				);
			}
			return rawBody;
		} catch (error) {
			if (providerCompleted) {
				throw error;
			}
			if (db && auth && requestId) {
				try {
					await trackSpendLog(
						db,
						await buildSpendLogFromRequest({
							req: req,
							auth: auth,
							requestId: requestId,
							callType: CallType.AEmbedding,
							model: model,
							startTime: startTime,
							endTime: new Date(),
							messages: input,
							error: error,
							status: SpendLogStatus.Failure,
							fallbackModels: [model],
							modelResolutionChain: copyModelResolutionChain(modelResolutionTrace),
							attemptedRetries: 0,
						}),
					);
				} catch (accountingError) {
					logger.error("Provider 失败后的花费账务提交失败", { accountingError: accountingError, requestId: requestId });
					try {
						await releaseSpend(db, requestId);
					} catch (releaseError) {
						logger.error("Provider 失败后释放 reservation 失败", { error: releaseError, requestId: requestId });
					}
				}
			}
			throw error;
		} finally {
			spendReservation?.heartbeat?.stop();
		}
	};
}
