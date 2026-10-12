import { modelCostMapService } from "../cost/ModelCostMapService";

/**
 * @param model
 */
export function anthropicModelCapabilities(model: string): Readonly<Record<string, unknown>> | undefined {
	const map = modelCostMapService.getSnapshot().map;
	const bare = model.slice(model.indexOf("/") + 1);
	return map[model] ?? map[bare] ?? map[bare.replaceAll("_", "-")];
}

/**
 * Translate adaptive effort only for known Anthropic models that do not support it natively.
 * @param body
 * @param model
 */
export function normalizeAnthropicThinking(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const capability = anthropicModelCapabilities(model);
	const normalized = { ...body };
	if (body["drop_params"] === true && capability?.["supports_sampling_params"] === false) {
		delete normalized["temperature"];
		delete normalized["top_p"];
		delete normalized["top_k"];
	}
	delete normalized["drop_params"];
	body = normalized;
	if (
		!capability ||
		capability["litellm_provider"] !== "anthropic" ||
		capability["supports_adaptive_thinking"] === true ||
		/(?:opus|sonnet)[-_]4[-_.]6/.test(model)
	) {
		return body;
	}
	const result = { ...body };
	const thinking = body["thinking"] as Record<string, unknown> | undefined;
	const output = body["output_config"] as Record<string, unknown> | undefined;
	const effort = typeof output?.["effort"] === "string" ? output["effort"] : undefined;
	if (thinking?.["type"] !== "adaptive" && effort === undefined) {
		return body;
	}
	const nativeEffort =
		capability["supports_output_config"] === true &&
		(!effort || ["low", "medium", "high"].includes(effort) || capability[`supports_${effort}_reasoning_effort`] === true);
	if (nativeEffort) {
		if (thinking?.["type"] === "adaptive") {
			delete result["thinking"];
		}
		return result;
	}
	const budgets: Record<string, number> = { minimal: 1024, low: 1024, medium: 2048, high: 4096, xhigh: 8192, max: 8192 };
	const maxTokens = typeof body["max_tokens"] === "number" ? body["max_tokens"] : 4096;
	const budget = Math.min(budgets[effort ?? "medium"] ?? 2048, maxTokens - 1);
	if (capability["supports_reasoning"] === true && effort !== "none" && budget >= 1024) {
		result["thinking"] = { type: "enabled", budget_tokens: budget };
	} else {
		delete result["thinking"];
	}
	if (output && "effort" in output) {
		const rest = { ...output };
		delete rest["effort"];
		if (Object.keys(rest).length) {
			result["output_config"] = rest;
		} else {
			delete result["output_config"];
		}
	}
	return result;
}
