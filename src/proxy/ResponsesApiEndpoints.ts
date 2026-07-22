/**
 * Responses API 端点。
 *
 * POST 创建请求委托 LiteLLM Router；查询/删除需要 Responses 持久化存储，当前显式返回 404。
 */
import type { Request, Response, Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { DrizzleDb } from "../core/db/Database";
import { calculateAndSetCost, injectResponseCostHeader, buildSpendLogFromRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse } from "../types/openai";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("ResponsesAPI");

interface ResponsesCreateRequest {
	/** Responses API 模型名 */
	model?: string;
	/** 用户输入，兼容字符串和 OpenAI Responses input 数组 */
	input?: unknown;
	/** 系统/开发者指令 */
	instructions?: string;
	/** 允许透传 Python LiteLLM 尚未显式建模的 provider 字段 */
	[key: string]: unknown;
}

/**
 * 注册 Responses API 路由。
 * @param router - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例；未传时 POST 返回 503，保留旧调用兼容
 * @param db - Drizzle 数据库实例；传入时记录 SpendLogs
 */
export function registerResponsesApiRoutes(router: Router, litellmRouter?: LiteLLMRouter, db?: DrizzleDb): void {
	const createHandler = createResponsesHandler(litellmRouter, db);
	registerRoute(router, { method: "post", path: "/v1/responses" }, createHandler);
	registerRoute(router, { method: "post", path: "/responses" }, createHandler);
	registerRoute(router, { method: "get", path: "/v1/responses/:id" }, responseNotFound);
	registerRoute(router, { method: "get", path: "/responses/:id" }, responseNotFound);
	registerRoute(router, { method: "delete", path: "/v1/responses/:id" }, responseNotFound);
	registerRoute(router, { method: "delete", path: "/responses/:id" }, responseNotFound);
}

function createResponsesHandler(litellmRouter: LiteLLMRouter | undefined, db: DrizzleDb | undefined) {
	return async (req: Request, res: Response): Promise<Record<string, unknown>> => {
		if (!litellmRouter) {
			throw Object.assign(new Error("Responses 创建暂未实现"), { statusCode: 503 });
		}
		const reqBody = req.body as ResponsesCreateRequest;
		const model = reqBody.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}
		const input = reqBody.input;
		if (input === undefined) {
			throw ApiError.badRequest("input 字段缺失");
		}
		const content = buildResponsesInputContent(input, reqBody.instructions);
		const messages = [{ role: "user", content: content }];
		const optionalParams: Record<string, unknown> = { ...reqBody };
		delete optionalParams.model;
		const startTime = new Date();
		try {
			const result = await litellmRouter.completion(model, messages, optionalParams);
			// 批次 9: 实际执行 deployment 的 spend 归因（provider/api_base/model_id/model_info 价格）
			const spendInfo = (result as unknown as { _spendInfo?: DeploymentSpendInfo })._spendInfo;
			calculateAndSetCost(result as unknown as ModelResponse, model, spendInfo?.customCostPerToken);
			const usage = (result as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
			if (usage && usage["cost"] !== undefined) {
				injectResponseCostHeader(res, usage["cost"] as number);
			}
			if (db && req.auth) {
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
					messages: input,
					response: result,
					usage: usage,
					status: SpendLogStatus.Success,
				});
				trackSpendLog(db, spendLog).catch((err) => logger.error("Responses 花费追踪失败", { error: err }));
			}
			return result as Record<string, unknown>;
		} catch (error) {
			if (db && req.auth) {
				const endTime = new Date();
				const failureSpendLog = buildSpendLogFromRequest({
					req: req,
					auth: req.auth,
					callType: CallType.ACompletion,
					model: model,
					startTime: startTime,
					endTime: endTime,
					messages: input,
					error: error,
					status: SpendLogStatus.Failure,
				});
				trackSpendLog(db, failureSpendLog).catch((err) => logger.error("Responses 失败花费追踪失败", { error: err }));
			}
			throw error;
		}
	};
}

function buildResponsesInputContent(input: unknown, instructions: string | undefined): string {
	const inputContent = typeof input === "string" ? input : JSON.stringify(input);
	if (instructions && instructions.length > 0) {
		return `${instructions}\n${inputContent}`;
	}
	return inputContent;
}

function responseNotFound(): never {
	throw ApiError.notFound("Response not found");
}
