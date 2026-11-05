/**
 * DeepSeek 思考模式回显被拒后的降级重试依据。
 *
 * 代理侧已经尽力补齐历史（见 providers/deepseekResponsesHistory.ts）。若上游仍以
 * “推理必须回显”拒绝，说明校验规则变了；此时把这一次请求的思考模式关掉重试一次，
 * 比把 400 直接抛给客户端更可解释——代价是这次回答没有思维链，因此只在末次拒绝后使用。
 */

/** 降级标记：随 optionalParams 传递，保证同一次请求最多降级一次。 */
export const DEEPSEEK_THINKING_DOWNGRADE_PARAM = "__litellm_deepseek_thinking_downgraded";

/**
 * 判断错误是否来自“思考模式推理必须回显”的上游拒绝。
 * @param error - 上游抛出的错误
 */
export function isThinkingReplayRejection(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return message.includes("reasoning_text") && message.includes("must be passed back");
}

/**
 * 构造关闭思考后的原生 Responses 请求体。
 *
 * 没有工具时上游不会校验回显，已经关闭思考时也没有降级空间，两种情况都返回 undefined。
 * @param callType - 路由调用类型，只有 responses 适用
 * @param body - 原始原生 Responses 请求体
 */
export function buildThinkingDowngradedResponsesBody(callType: unknown, body: unknown): Record<string, unknown> | undefined {
	if (callType !== "responses" || typeof body !== "object" || body === null || Array.isArray(body)) {
		return undefined;
	}
	const record = body as Record<string, unknown>;
	const tools = record["tools"];
	if (!Array.isArray(tools) || tools.length === 0) {
		return undefined;
	}
	const reasoning = record["reasoning"];
	const reasoningRecord =
		typeof reasoning === "object" && reasoning !== null && !Array.isArray(reasoning)
			? (reasoning as Record<string, unknown>)
			: {};
	if (reasoningRecord["effort"] === "none") {
		return undefined;
	}
	return { ...record, reasoning: { ...reasoningRecord, effort: "none" } };
}
