/**
 * Embeddings 端点 — 将 /v1/embeddings 请求代理到目标 Provider
 *
 * 类似 Chat Completions 但专用于文本嵌入。
 * 支持标准 OpenAI Embeddings API 格式的输入。
 */

import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { EmbeddingResponse } from "../types/embedding";
import { runCommonChecks } from "../auth/AuthChecks";

/**
 * 注册 Embeddings 路由到 Express Router
 *
 * 覆盖以下路径：
 * - POST /v1/embeddings（标准 OpenAI）
 * - POST /embeddings（简写）
 * @param expressRouter - Express Router 实例
 * @param litellmRouter - LiteLLM Router 实例
 */
export function registerEmbeddingsRoutes(expressRouter: Router, litellmRouter: LiteLLMRouter): void {
	const handler = createEmbeddingsHandler(litellmRouter);

	registerRoute(expressRouter, { method: "post", path: "/v1/embeddings" }, handler);
	registerRoute(expressRouter, { method: "post", path: "/embeddings" }, handler);
}

/**
 * 创建 Embeddings 请求处理器
 * @param litellmRouter - LiteLLM Router 实例
 */
function createEmbeddingsHandler(litellmRouter: LiteLLMRouter) {
	return async (req: import("express").Request, _res: import("express").Response): Promise<EmbeddingResponse> => {
		const model = req.body.model;
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

		// 获取可用部署
		const candidate = litellmRouter.getAvailableDeployment(model);
		if (!candidate) {
			throw ApiError.unavailable(`模型 "${model}" 当前无可用部署`);
		}

		const { deployment, provider } = candidate;

		// 构造 Provider 请求 — 使用标准 OpenAI 格式
		const providerReq = provider.transformRequest(deployment.litellm_params.model, [], optionalParams);

		// 替换 /chat/completions 路径为 /embeddings
		const url = providerReq.url.replace("/chat/completions", "/embeddings");

		// 构造 embeddings 专用的请求体
		const embedBody = {
			model:
				providerReq.body && typeof providerReq.body === "object"
					? (providerReq.body as Record<string, unknown>).model
					: deployment.litellm_params.model,
			input: input,
			...optionalParams,
		};

		const response = await fetch(url, {
			method: "POST",
			headers: providerReq.headers,
			body: JSON.stringify(embedBody),
		});

		if (!response.ok) {
			const errorBody = await response.json().catch(() => ({}));
			throw new ApiError(response.status, `Provider 返回错误: ${JSON.stringify(errorBody)}`);
		}

		const rawBody = await response.json();
		return rawBody as EmbeddingResponse;
	};
}
