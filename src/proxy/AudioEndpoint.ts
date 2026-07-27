/**
 * Audio 端点 — 语音合成与转录。
 *
 * 对应 OpenAI 的 /v1/audio/speech 和 /v1/audio/transcriptions 端点。
 * endpoint 保持薄层，provider 选择、重试、fallback 交给 LiteLLM Router。
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

const logger = createModuleLogger("Proxy:Audio");

/** 语音合成请求体 */
interface SpeechRequest {
	/** 输入文本 */
	input: string;
	/** 语音模型 */
	model: string;
	/** 语音名称 */
	voice: string;
	/** 响应格式 */
	response_format?: string;
	/** 语速 */
	speed?: number;
	/** 允许透传 Python LiteLLM 尚未显式建模的 provider 字段 */
	[key: string]: unknown;
}

/** 转录请求体 */
interface TranscriptionRequest {
	/** 音频文件 */
	file: unknown;
	/** 转录模型 */
	model: string;
	/** 语言 */
	language?: string;
	/** 提示词 */
	prompt?: string;
	/** 响应格式 */
	response_format?: string;
	/** 温度 */
	temperature?: number;
	/** 允许透传 Python LiteLLM 尚未显式建模的 provider 字段 */
	[key: string]: unknown;
}

/** Audio 控制器。 */
export class AudioController {
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
	 * 语音合成（TTS）。
	 * @param reqBody - 语音合成请求体
	 * @param request - Express 请求对象，用于 SpendLogs 上下文
	 */
	@noAuth()
	@post("/v1/audio/speech")
	async speech(@body() reqBody: SpeechRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._speech(reqBody, request);
	}

	/**
	 * 语音合成（Python LiteLLM 非 v1 别名）。
	 * @param reqBody - 语音合成请求体
	 * @param request
	 */
	@noAuth()
	@post("/audio/speech")
	async speechAlias(@body() reqBody: SpeechRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._speech(reqBody, request);
	}

	/**
	 * 语音转录（ASR）。
	 * @param reqBody - 转录请求体
	 * @param request
	 */
	@noAuth()
	@post("/v1/audio/transcriptions")
	async transcribe(@body() reqBody: TranscriptionRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._transcribe(reqBody, request);
	}

	/**
	 * 语音转录（Python LiteLLM 非 v1 别名）。
	 * @param reqBody - 转录请求体
	 * @param request
	 */
	@noAuth()
	@post("/audio/transcriptions")
	async transcribeAlias(@body() reqBody: TranscriptionRequest, @req() request: Request): Promise<Record<string, unknown>> {
		return await this._transcribe(reqBody, request);
	}

	private async _speech(reqBody: SpeechRequest, request: Request): Promise<Record<string, unknown>> {
		const litellmRouter = this._litellmRouter;
		if (!litellmRouter) {
			throwSpeechUnavailable();
		}
		const model = reqBody.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		const input = reqBody.input;
		if (typeof input !== "string" || input.length === 0) {
			throw ApiError.badRequest("input 字段缺失");
		}
		if (request.auth) {
			runCommonChecks(request.auth, model);
		}
		const optionalParams: Record<string, unknown> = { ...reqBody };
		delete optionalParams.model;
		const messages = [{ role: "user", content: input }];
		return await this._runAudioCompletion(request, model, messages, optionalParams, CallType.ASpeech, input);
	}

	private async _transcribe(reqBody: TranscriptionRequest, request: Request): Promise<Record<string, unknown>> {
		const litellmRouter = this._litellmRouter;
		if (!litellmRouter) {
			throwTranscriptionUnavailable();
		}
		const model = reqBody.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		const prompt = typeof reqBody.prompt === "string" ? reqBody.prompt : "";
		if (request.auth) {
			runCommonChecks(request.auth, model);
		}
		const optionalParams: Record<string, unknown> = { ...reqBody };
		delete optionalParams.model;
		const messages = [{ role: "user", content: prompt }];
		return await this._runAudioCompletion(request, model, messages, optionalParams, CallType.ATranscription, prompt);
	}

	private async _runAudioCompletion(
		request: Request,
		model: string,
		messages: Array<{ role: string; content: string }>,
		optionalParams: Record<string, unknown>,
		callType: CallType,
		storedMessages: unknown,
	): Promise<Record<string, unknown>> {
		const litellmRouter = this._litellmRouter;
		if (!litellmRouter) {
			throwSpeechUnavailable();
		}
		const startTime = new Date();
		const db = this._db;
		const auth = request.auth;
		const spendReservation = await reserveEndpointSpend(db, litellmRouter, request, model, optionalParams, {
			costMode: "audio",
			callType: callType,
			startTime: startTime,
		});
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
					await buildSpendLogFromRequest({
						req: request,
						auth: auth,
						requestId: requestId,
						callType: callType,
						model: model,
						modelGroup: model,
						modelId: spendInfo?.modelId,
						customLlmProvider: spendInfo?.customLlmProvider,
						apiBase: spendInfo?.apiBase,
						customCostPerToken: spendInfo?.customCostPerToken,
						deploymentModel: spendInfo?.deploymentModel,
						startTime: startTime,
						endTime: new Date(),
						messages: storedMessages,
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
						await buildSpendLogFromRequest({
							req: request,
							auth: auth,
							requestId: requestId,
							callType: callType,
							model: model,
							startTime: startTime,
							endTime: new Date(),
							messages: storedMessages,
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

function throwSpeechUnavailable(): never {
	throw ApiError.unavailable("语音合成（TTS）暂未实现，将在后续版本支持");
}

function throwTranscriptionUnavailable(): never {
	throw ApiError.unavailable("语音转录（ASR）暂未实现，将在后续版本支持");
}
