/**
 * Util 端点
 *
 * GET /utils/supported_openai_params：返回指定模型的 supported_openai_params 清单，
 * 对齐 Python litellm/proxy/proxy_server.py supported_openai_params
 * （get_llm_provider 解析 provider → get_supported_openai_params 静态清单；
 * 无法映射 → 400 {detail:{error:"Could not map model=X"}}）。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { lookupModelCostEntry, deriveSupportedOpenaiParams } from "./modelGroupBuilder";

/**
 * @param router
 */
export function registerUtilRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/utils/token_counter" }, notImpl("Token Counter"));

	registerRoute(router, { method: "get", path: "/utils/supported_openai_params" }, (req) => {
		const modelParam = req.query["model"];
		const model = typeof modelParam === "string" ? modelParam : undefined;
		// PY: FastAPI 缺必填 query 参数 → 422
		if (!model) {
			throw ApiError.unprocessableEntity([{ loc: ["query", "model"], msg: "Field required", type: "missing" }]);
		}
		const { provider, strippedModel } = resolveModelProvider(model);
		if (provider === null) {
			// PY: HTTPException(400, detail={"error": "Could not map model=..."})
			throw ApiError.httpException(400, { error: `Could not map model=${model}` });
		}
		const entry = lookupModelCostEntry(model);
		return { supported_openai_params: deriveSupportedOpenaiParams(provider, entry, strippedModel) };
	});

	registerRoute(router, { method: "post", path: "/utils/transform_request" }, notImpl("Transform Request"));
}

/**
 * 解析 model 串的 provider（对齐 Python litellm.get_llm_provider 核心语义）：
 * 1. "provider/model" 形式：取前缀为 provider
 * 2. 无前缀：查 cost map 条目的 litellm_provider
 * 3. 均失败 → null（Python 抛异常 → 400 Could not map）
 * @param model - 请求模型名
 */
function resolveModelProvider(model: string): { provider: string | null; strippedModel: string } {
	const slashIndex = model.indexOf("/");
	if (slashIndex !== -1) {
		const prefix = model.slice(0, slashIndex);
		// PY: get_llm_provider 对未知 provider 前缀抛错
		const entry = lookupModelCostEntry(model);
		const entryProvider = typeof entry?.["litellm_provider"] === "string" ? entry["litellm_provider"] : null;
		if (entryProvider !== null) {
			return { provider: entryProvider, strippedModel: model.slice(slashIndex + 1) };
		}
		if (prefix === "openai" || prefix === "anthropic" || prefix === "azure" || prefix === "azure_ai") {
			return { provider: prefix, strippedModel: model.slice(slashIndex + 1) };
		}
		return { provider: null, strippedModel: model };
	}
	const entry = lookupModelCostEntry(model);
	const entryProvider = typeof entry?.["litellm_provider"] === "string" ? entry["litellm_provider"] : null;
	return { provider: entryProvider, strippedModel: model };
}

function notImpl(name: string) {
	return () => {
		throw new ApiError(503, `${name} 暂未实现`);
	};
}
