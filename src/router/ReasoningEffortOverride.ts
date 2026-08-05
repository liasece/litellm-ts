import type { Deployment } from "../types/router";

export const REASONING_EFFORT_OVERRIDE_FIELD = "override_reasoning_effort";

export const REASONING_EFFORT_OVERRIDE_VALUES = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffortOverride = (typeof REASONING_EFFORT_OVERRIDE_VALUES)[number];
export type ReasoningEffortProtocol = "chat" | "responses" | "anthropic";

const REASONING_EFFORT_OVERRIDE_VALUE_SET = new Set<string>(REASONING_EFFORT_OVERRIDE_VALUES);

/**
 * Read and validate the deployment-level reasoning effort override.
 * The field lives in model_info so it never leaks into provider request bodies
 * unless an outbound protocol adapter explicitly applies it.
 */
export function getReasoningEffortOverride(deployment: Deployment): ReasoningEffortOverride | undefined {
	const rawValue = (deployment.model_info as Record<string, unknown> | undefined)?.[REASONING_EFFORT_OVERRIDE_FIELD];
	if (rawValue === undefined || rawValue === null || rawValue === "") {
		return undefined;
	}
	if (typeof rawValue !== "string" || !REASONING_EFFORT_OVERRIDE_VALUE_SET.has(rawValue)) {
		throw new Error(`${REASONING_EFFORT_OVERRIDE_FIELD} must be one of: ${REASONING_EFFORT_OVERRIDE_VALUES.join(", ")}`);
	}
	return rawValue as ReasoningEffortOverride;
}

/** Validate protocol-specific restrictions that can be inferred from model configuration. */
export function validateReasoningEffortOverride(deployment: Deployment): void {
	const effort = getReasoningEffortOverride(deployment);
	if (effort !== "minimal") {
		return;
	}
	const provider = deployment.litellm_params.custom_llm_provider?.toLowerCase();
	const model = deployment.litellm_params.model.toLowerCase();
	if (provider === "anthropic" || model.startsWith("anthropic/") || model.includes("claude")) {
		throw new Error("Anthropic reasoning effort override does not support minimal");
	}
}

/**
 * Force the configured effort at the final protocol boundary while preserving
 * sibling protocol settings such as Responses reasoning summaries and
 * Anthropic output schemas.
 */
export function applyReasoningEffortOverride(
	body: Record<string, unknown>,
	deployment: Deployment,
	protocol: ReasoningEffortProtocol,
): Record<string, unknown> {
	const effort = getReasoningEffortOverride(deployment);
	if (effort === undefined) {
		return body;
	}

	if (protocol === "responses") {
		const reasoning =
			typeof body["reasoning"] === "object" && body["reasoning"] !== null && !Array.isArray(body["reasoning"])
				? (body["reasoning"] as Record<string, unknown>)
				: {};
		return { ...body, reasoning: { ...reasoning, effort: effort } };
	}

	if (protocol === "anthropic") {
		if (effort === "minimal") {
			throw new Error("Anthropic reasoning effort override does not support minimal");
		}
		const outputConfig =
			typeof body["output_config"] === "object" && body["output_config"] !== null && !Array.isArray(body["output_config"])
				? (body["output_config"] as Record<string, unknown>)
				: {};
		return { ...body, output_config: { ...outputConfig, effort: effort } };
	}

	const chatReasoning =
		typeof body["reasoning"] === "object" && body["reasoning"] !== null && !Array.isArray(body["reasoning"])
			? (body["reasoning"] as Record<string, unknown>)
			: undefined;
	return {
		...body,
		reasoning_effort: effort,
		...(chatReasoning ? { reasoning: { ...chatReasoning, effort: effort } } : {}),
	};
}
