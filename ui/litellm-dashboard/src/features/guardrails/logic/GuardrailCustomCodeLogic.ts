import type { GuardrailRecord } from "../support/GuardrailModels";
export function normalizeGuardrailModes(mode: unknown): string[] {
	if (mode == null) return ["pre_call"];
	if (Array.isArray(mode)) return mode.length ? mode.filter((item): item is string => typeof item === "string") : ["pre_call"];
	return [String(mode)];
}
export function guardrailTestInputType(modes: string[]): "request" | "response" {
	return modes.some((value) => ["pre_call", "pre_mcp_call"].includes(value))
		? "request"
		: modes.some((value) => ["post_call", "post_mcp_call"].includes(value))
			? "response"
			: "request";
}
export function customGuardrailPayload(name: string, code: string, mode: string[], defaultOn: boolean, edit?: GuardrailRecord | null) {
	const params: Record<string, unknown> = { custom_code: code },
		body: Record<string, unknown> = { litellm_params: params };
	if (!edit)
		return {
			guardrail_name: name,
			litellm_params: { ...params, guardrail: "custom_code", mode, default_on: defaultOn },
			guardrail_info: {},
		};
	if (name !== edit.guardrail_name) body.guardrail_name = name;
	if (JSON.stringify(mode) !== JSON.stringify(normalizeGuardrailModes(edit.litellm_params.mode))) params.mode = mode;
	if (defaultOn !== edit.litellm_params.default_on) params.default_on = defaultOn;
	return body;
}
