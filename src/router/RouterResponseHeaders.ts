/**
 * Router 响应头处理 helper
 *
 * 从 Router 中拆出，专门处理上游 provider 响应头与下游响应头的提取/合并。
 * 对齐 PY `router.py:5715-5744 set_response_headers` 的两条逻辑：
 *   - 从上游 Response 提取需要透传的标准头（ratelimit / retry-after / anthropic-*）
 *   - 把命中 deployment 的 metadata 注入为 `x-litellm-*` 头
 */

import type { Deployment } from "../types/router";

/**
 * 上游标准透传头白名单（小写键）
 * - 速率限制类：x-ratelimit-* （OpenAI / Anthropic 等通用）
 * - 重试控制：retry-after
 * - 链路追踪：x-request-id
 */
const PROVIDER_PASSTHROUGH_HEADERS: readonly string[] = [
	"x-request-id",
	"x-ratelimit-remaining-tokens",
	"x-ratelimit-remaining-requests",
	"x-ratelimit-limit-tokens",
	"x-ratelimit-limit-requests",
	"retry-after",
];

/** Anthropic 专属 ratelimit 头前缀（动态匹配，避免硬编码具体名称） */
const ANTHROPIC_RATELIMIT_PREFIX = "anthropic-ratelimit-";

/**
 * 从上游 Response 提取要透传给调用方的 provider headers。
 *
 * 对齐 PY `router.py:5715-5744 set_response_headers`。返回 undefined 表示无任何
 * 有效字段，调用方据此决定是否在响应中注入这组头。
 * @param response - 上游 fetch Response
 */
export function extractProviderHeaders(response: Response): Record<string, string> | undefined {
	if (!response.headers) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const k of PROVIDER_PASSTHROUGH_HEADERS) {
		const v = response.headers.get(k);
		if (v !== null) {
			out[k] = v;
		}
	}
	// 透传 anthropic-ratelimit-* 头（动态匹配）
	response.headers.forEach((value, key) => {
		if (key.toLowerCase().startsWith(ANTHROPIC_RATELIMIT_PREFIX)) {
			out[key] = value;
		}
	});
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把命中 deployment 的 metadata 合并到响应头中，供下游 endpoint 透传给客户端。
 *
 * 注入的字段：
 *   - x-litellm-model-id: deployment.model_info.id（命中 deployment 标识）
 *   - x-litellm-model-group: deployment.model_name（模型组名）
 * @param deployment - 实际命中的 deployment
 * @param baseHeaders - 已有的 provider 透传头（来自 extractProviderHeaders）
 */
export function buildResponseHeaders(deployment: Deployment, baseHeaders?: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = { ...(baseHeaders ?? {}) };
	const modelId = deployment.model_info?.id;
	if (typeof modelId === "string" && modelId.length > 0) {
		out["x-litellm-model-id"] = modelId;
	}
	out["x-litellm-model-group"] = deployment.model_name;
	return out;
}
