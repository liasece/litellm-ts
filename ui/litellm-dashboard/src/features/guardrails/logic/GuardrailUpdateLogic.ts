import type {
	GuardrailRecord,
	GuardrailProviderParameters,
	GuardrailContentDraft,
	ToolPermissionConfig,
	ProviderParam,
} from "../support/GuardrailModels";
import { guardrailRecord } from "../support/GuardrailClipboardSupport";
import { formatGuardrailContent } from "./GuardrailContentLogic";
import { guardrail_provider_map } from "./GuardrailProviderLogic";
const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b),
	meaningful = (value: unknown) => value !== undefined && value !== null && value !== "";
export function guardrailOptionalInitialValues(params: Record<string, unknown>, fields: Record<string, ProviderParam> = {}) {
	const values = { ...guardrailRecord(params.optional_params) };
	for (const name of Object.keys(fields)) if (values[name] === undefined && params[name] !== undefined) values[name] = params[name];
	return values;
}
export function toolPermissionsFromGuardrail(record: GuardrailRecord): ToolPermissionConfig {
	const params = record.litellm_params;
	return {
		rules: Array.isArray(params.rules) ? (params.rules as ToolPermissionConfig["rules"]) : [],
		default_action: String(params.default_action || "deny").toLowerCase(),
		on_disallowed_action: String(params.on_disallowed_action || "block").toLowerCase(),
		violation_message_template: String(params.violation_message_template || ""),
	};
}
export function buildGuardrailUpdatePayload(
	record: GuardrailRecord,
	values: Record<string, unknown>,
	providers: GuardrailProviderParameters | null,
	entities: string[],
	actions: Record<string, string>,
	content: GuardrailContentDraft,
	contentDirty: boolean,
	tools: ToolPermissionConfig,
	toolDirty: boolean,
) {
	const params: Record<string, unknown> = {},
		body: Record<string, unknown> = { litellm_params: params },
		original = record.litellm_params;
	if (values.guardrail_name !== record.guardrail_name) body.guardrail_name = values.guardrail_name;
	if (values.default_on !== original.default_on) params.default_on = values.default_on;
	const info = values.guardrail_info ? (JSON.parse(String(values.guardrail_info)) as unknown) : undefined;
	if (different(record.guardrail_info, info)) body.guardrail_info = info;
	const pii = Object.fromEntries(entities.map((entity) => [entity, actions[entity] || "MASK"]));
	if (different(original.pii_entities_config || {}, pii)) params.pii_entities_config = pii;
	if (original.guardrail === "litellm_content_filter" && contentDirty) {
		const formatted = formatGuardrailContent(content);
		Object.assign(params, formatted, { competitor_intent_config: formatted.competitor_intent_config ?? null });
	}
	if (original.guardrail === "tool_permission") {
		const previous = toolPermissionsFromGuardrail(record);
		if (
			toolDirty ||
			different(previous.rules, tools.rules) ||
			previous.default_action !== tools.default_action.toLowerCase() ||
			previous.on_disallowed_action !== tools.on_disallowed_action.toLowerCase() ||
			previous.violation_message_template !== tools.violation_message_template
		)
			Object.assign(params, {
				rules: tools.rules,
				default_action: tools.default_action.toLowerCase(),
				on_disallowed_action: tools.on_disallowed_action.toLowerCase(),
				violation_message_template: tools.violation_message_template || null,
			});
	}
	const provider = Object.keys(guardrail_provider_map).find((key) => guardrail_provider_map[key] === original.guardrail);
	if (providers && provider && original.guardrail !== "tool_permission") {
		const fields = providers[guardrail_provider_map[provider]?.toLowerCase()] ?? {},
			allowed = new Set(Object.keys(fields).filter((key) => key !== "optional_params")),
			nested = guardrailRecord(values.optional_params);
		Object.keys(fields.optional_params?.fields ?? {}).forEach((key) => allowed.add(key));
		for (const key of allowed) {
			if (["patterns", "blocked_words", "categories"].includes(key)) continue;
			let value = values[key];
			if (!meaningful(value)) value = nested[key];
			if (different(value, original[key])) {
				if (meaningful(value)) params[key] = value;
				else if (meaningful(original[key])) params[key] = null;
			}
		}
	}
	if (!Object.keys(params).length) delete body.litellm_params;
	return body;
}
