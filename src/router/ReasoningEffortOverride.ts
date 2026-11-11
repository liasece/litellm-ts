import type { Deployment } from "../types/router";

/** Model-level default effort; used only when the caller request sets no effort. */
export const REASONING_EFFORT_OVERRIDE_FIELD = "override_reasoning_effort";
/** Model-level forced effort; replaces the caller's effort whether or not it is set. */
export const FORCE_REASONING_EFFORT_FIELD = "force_reasoning_effort";

export const REASONING_EFFORT_OVERRIDE_VALUES = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Accepted deployment override values; individual protocols may reject a subset. */
export type ReasoningEffortOverride = (typeof REASONING_EFFORT_OVERRIDE_VALUES)[number];
/** Outbound wire protocol that determines where reasoning effort is written. */
export type ReasoningEffortProtocol = "chat" | "responses" | "anthropic";

const REASONING_EFFORT_OVERRIDE_VALUE_SET = new Set<string>(REASONING_EFFORT_OVERRIDE_VALUES);

/**
 * Read and validate one deployment-level reasoning effort setting.
 * The fields live in model_info so they never leak into provider request bodies
 * unless an outbound protocol adapter explicitly applies them.
 * @param deployment - Deployment whose model_info contains the optional setting.
 * @param field - model_info key holding the setting.
 * @throws {Error} If the configured value is not one of the accepted values.
 */
function readReasoningEffort(deployment: Deployment, field: string): ReasoningEffortOverride | undefined {
	const rawValue = (deployment.model_info as Record<string, unknown> | undefined)?.[field];
	if (rawValue === undefined || rawValue === null || rawValue === "") {
		return undefined;
	}
	if (typeof rawValue !== "string" || !REASONING_EFFORT_OVERRIDE_VALUE_SET.has(rawValue)) {
		throw new Error(`${field} must be one of: ${REASONING_EFFORT_OVERRIDE_VALUES.join(", ")}`);
	}
	return rawValue as ReasoningEffortOverride;
}

/**
 * Read the default reasoning effort applied when the caller request carries none.
 * @param deployment - Deployment whose model_info contains the optional default.
 * @throws {Error} If the configured default is not one of the accepted values.
 */
export function getReasoningEffortOverride(deployment: Deployment): ReasoningEffortOverride | undefined {
	return readReasoningEffort(deployment, REASONING_EFFORT_OVERRIDE_FIELD);
}

/**
 * Read the forced reasoning effort applied regardless of the caller request.
 * @param deployment - Deployment whose model_info contains the optional forced value.
 * @throws {Error} If the configured forced value is not one of the accepted values.
 */
export function getForcedReasoningEffort(deployment: Deployment): ReasoningEffortOverride | undefined {
	return readReasoningEffort(deployment, FORCE_REASONING_EFFORT_FIELD);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether the caller already decided how deeply the model should think.
 * Explicit effort values, Anthropic `output_config.effort` and structured
 * thinking budgets all count: the default setting must not overwrite a
 * caller that already made this decision.
 * @param request - Caller-level request params (before deployment params are merged).
 */
function requestChoosesReasoningEffort(request: Record<string, unknown>): boolean {
	if (isNonEmptyString(request["reasoning_effort"])) {
		return true;
	}
	const reasoning = request["reasoning"];
	if (isRecord(reasoning) && isNonEmptyString(reasoning["effort"])) {
		return true;
	}
	const outputConfig = request["output_config"];
	if (isRecord(outputConfig) && isNonEmptyString(outputConfig["effort"])) {
		return true;
	}
	const thinking = request["thinking"];
	return isRecord(thinking) && (isNonEmptyString(thinking["type"]) || typeof thinking["budget_tokens"] === "number");
}

/**
 * Validate protocol-specific restrictions that can be inferred from model configuration.
 * @param deployment - Deployment supplying the settings and provider/model identity.
 * @throws {Error} If a setting is invalid or minimal is configured for an Anthropic model.
 */
export function validateReasoningEffortOverride(deployment: Deployment): void {
	const provider = deployment.litellm_params.custom_llm_provider?.toLowerCase();
	const model = deployment.litellm_params.model.toLowerCase();
	for (const field of [FORCE_REASONING_EFFORT_FIELD, REASONING_EFFORT_OVERRIDE_FIELD]) {
		if (readReasoningEffort(deployment, field) !== "minimal") {
			continue;
		}
		if (provider === "anthropic" || model.startsWith("anthropic/") || model.includes("claude")) {
			throw new Error(`Anthropic reasoning effort override does not support minimal (${field})`);
		}
	}
}

/**
 * Apply the configured effort at the final protocol boundary while preserving
 * sibling protocol settings such as Responses reasoning summaries and
 * Anthropic output schemas.
 *
 * The forced setting always replaces the caller's effort. The default setting
 * only fills requests that carry no effort choice of their own, so a caller
 * that already picked a depth keeps it.
 * @param body - Outbound request body; sibling protocol settings are preserved.
 * @param deployment - Deployment supplying the optional reasoning effort settings.
 * @param protocol - Protocol used by the outbound provider request.
 * @param request - Caller-level request params used to detect an explicit caller choice.
 * Chat callers merge deployment params into the outbound body, so `body` alone
 * cannot distinguish a caller choice from static deployment configuration.
 * @throws {Error} If a setting is invalid or minimal is requested for Anthropic.
 */
export function applyReasoningEffortOverride(
	body: Record<string, unknown>,
	deployment: Deployment,
	protocol: ReasoningEffortProtocol,
	request: Record<string, unknown> = body,
): Record<string, unknown> {
	const forced = getForcedReasoningEffort(deployment);
	const effort = forced ?? (requestChoosesReasoningEffort(request) ? undefined : getReasoningEffortOverride(deployment));
	if (effort === undefined) {
		return body;
	}

	if (protocol === "responses") {
		const reasoning = isRecord(body["reasoning"]) ? body["reasoning"] : {};
		return { ...body, reasoning: { ...reasoning, effort: effort } };
	}

	if (protocol === "anthropic") {
		if (effort === "minimal") {
			throw new Error("Anthropic reasoning effort override does not support minimal");
		}
		const outputConfig = isRecord(body["output_config"]) ? body["output_config"] : {};
		return { ...body, output_config: { ...outputConfig, effort: effort } };
	}

	const chatReasoning = isRecord(body["reasoning"]) ? body["reasoning"] : undefined;
	return {
		...body,
		reasoning_effort: effort,
		...(chatReasoning ? { reasoning: { ...chatReasoning, effort: effort } } : {}),
	};
}
