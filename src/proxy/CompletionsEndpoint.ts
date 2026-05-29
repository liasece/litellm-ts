/**
 * Completions 端点 — 文本补全（传统）
 *
 * 对应 OpenAI 的 /v1/completions 端点（text-davinci 等模型的遗留接口）。
 * 委托 LiteLLM Router 处理路由、重试和降级。
 */

import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";

/**
 * 注册 Completions 路由到 Express Router
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 */
export function registerCompletionsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter): void {
	const handler = createCompletionsHandler(litellmRouter);

	registerRoute(expressRouter, { method: "post", path: "/v1/completions" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/completions" }, handler);
}

/**
 * 创建 Completions 请求处理器
 *
 * 将 prompt 包装为单条 user 消息后委托 Router.completion。
 * @param litellmRouter - LiteLLM Router 实例
 */
function createCompletionsHandler(litellmRouter: LiteLLMRouter) {
	return async (req: import("express").Request): Promise<unknown> => {
		const model = req.body.model;
		if (!model || typeof model !== "string") {
			throw ApiError.badRequest("model 字段缺失");
		}

		const prompt = req.body.prompt;
		if (prompt === undefined) {
			throw ApiError.badRequest("prompt 字段缺失");
		}

		// 将 prompt 包装为 chat messages 再委托 Router
		const promptText = Array.isArray(prompt) ? prompt.join("") : String(prompt);
		const messages = [{ role: "user", content: promptText }];

		const optionalParams: Record<string, unknown> = { ...req.body };
		delete optionalParams.model;
		delete optionalParams.prompt;

		return await litellmRouter.completion(model, messages, optionalParams);
	};
}
