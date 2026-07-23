/**
 * Image 端点 — 图片生成。
 *
 * 对应 OpenAI 的 /v1/images/generations 端点。endpoint 只做请求校验和
 * OpenAI alias 注册，实际 provider 选择、重试、fallback 交给 LiteLLM Router。
 */

import type { Request } from "express";
import { post, noAuth, body, req } from "../core/api/decorators";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { DrizzleDb } from "../core/db/Database";
import { runCommonChecks } from "../auth/AuthChecks";
import { buildSpendLogFromRequest, calculateAndSetCost, releaseSpend, trackSpendLog } from "../spend/SpendTracker";
import { reserveEndpointSpend } from "../spend/SpendReservation";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse } from "../types/openai";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Proxy:Image");

/** 图片生成请求体 */
interface ImageGenerationRequest {
	/** 文本描述 */
	prompt: string;
	/** 生成模型 */
	model?: string;
	/** 生成数量 */
	n?: number;
	/** 图片尺寸 */
	size?: string;
	/** 图片格式 */
	response_format?: string;
	/** 图片风格 */
	style?: string;
	/** 图片质量 */
	quality?: string;
	/** 允许透传 Python LiteLLM 尚未显式建模的 provider 字段 */
	[key: string]: unknown;
}

/**
 * Image 控制器。
 *
 * 兼容复制版 Python LiteLLM Web/API 路径，把图片请求委托给 Router。
 */
export class ImageController {
	private readonly _litellmRouter: LiteLLMRouter | undefined;
	private readonly _db: DrizzleDb | undefined;

	/**
	 * @param litellmRouter - LiteLLM Router 实例；未传时保留旧测试/启动兼容，返回 503
	 * @param db - Drizzle 数据库实例；传入时记录 SpendLogs
	 */
	constructor(litellmRouter?: LiteLLMRouter, db?: DrizzleDb) {
		this._litellmRouter = litellmRouter;
		this._db = db;
	}

	/**
	 * 图片生成。
	 * @param reqBody - 图片生成请求体
	 * @param request - Express 请求对象，用于 SpendLogs 上下文
	 */
	@noAuth()
	@post("/v1/images/generations")
	async generate(@body() reqBody: ImageGenerationRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._generate(reqBody, request);
	}

	/**
	 * 图片生成（Python LiteLLM 非 v1 别名）。
	 * @param reqBody - 图片生成请求体
	 * @param request
	 */
	@noAuth()
	@post("/images/generations")
	async generateAlias(@body() reqBody: ImageGenerationRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._generate(reqBody, request);
	}

	private async _generate(reqBody: ImageGenerationRequest, request: Request): Promise<Record<string, unknown>> {
		const litellmRouter = this._litellmRouter;
		if (!litellmRouter) {
			throwImageGenerationUnavailable();
		}
		const model = reqBody.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		const prompt = reqBody.prompt;
		if (typeof prompt !== "string" || prompt.length === 0) {
			throw ApiError.badRequest("prompt 字段缺失");
		}
		if (request.auth) {
			runCommonChecks(request.auth, model);
		}
		const optionalParams: Record<string, unknown> = { ...reqBody };
		delete optionalParams.model;
		const messages = [{ role: "user", content: prompt }];
		const startTime = new Date();
		const db = this._db;
		const auth = request.auth;
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, request, model, reqBody, "image");
		const requestId = spendReservation?.requestId;
		let providerCompleted = false;
		try {
			spendReservation?.heartbeat?.markProviderStarted();
			const result = await litellmRouter.completion(model, messages, optionalParams);
			providerCompleted = true;
			const spendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
			calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
			const usage = (result as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
			if (db && auth && requestId) {
				await trackSpendLog(
					db,
					buildSpendLogFromRequest({
						req: request,
						auth: auth,
						requestId: requestId,
						callType: CallType.AImageGeneration,
						model: model,
						modelGroup: model,
						modelId: spendInfo?.modelId,
						customLlmProvider: spendInfo?.customLlmProvider,
						apiBase: spendInfo?.apiBase,
						customCostPerToken: spendInfo?.customCostPerToken,
						deploymentModel: spendInfo?.deploymentModel,
						startTime: startTime,
						endTime: new Date(),
						messages: prompt,
						response: result,
						usage: usage,
						status: SpendLogStatus.Success,
					}),
				);
			}
			return result as Record<string, unknown>;
		} catch (error) {
			if (providerCompleted) {
				throw error;
			}
			if (db && auth && requestId) {
				try {
					await trackSpendLog(
						db,
						buildSpendLogFromRequest({
							req: request,
							auth: auth,
							requestId: requestId,
							callType: CallType.AImageGeneration,
							model: model,
							startTime: startTime,
							endTime: new Date(),
							messages: prompt,
							error: error,
							status: SpendLogStatus.Failure,
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
	}
}

function throwImageGenerationUnavailable(): never {
	throw ApiError.unavailable("图片生成暂未实现，将在后续版本支持");
}
