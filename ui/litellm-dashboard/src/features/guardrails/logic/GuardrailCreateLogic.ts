import { guardrail_provider_map, shouldRenderContentFilterConfigSettings } from "./GuardrailProviderLogic";
import type { GuardrailContentDraft, GuardrailProviderParameters, ToolPermissionConfig } from "../support/GuardrailModels";
export interface GuardrailEndpointDraft {
	type: string;
	endSessionAfterNFails?: number;
	onViolation: string;
	message: string;
	open: boolean;
}
export class GuardrailDraftError extends Error {}
export const emptyToolPermissions = (): ToolPermissionConfig => ({
	rules: [],
	default_action: "deny",
	on_disallowed_action: "block",
	violation_message_template: "",
});
export const emptyGuardrailContent = (): GuardrailContentDraft => ({
	patterns: [],
	keywords: [],
	categories: [],
	pendingCategory: "",
	competitorEnabled: false,
	competitorConfig: null,
});
export function buildGuardrailCreatePayload(
	values: Record<string, unknown>,
	providers: GuardrailProviderParameters | null,
	content: GuardrailContentDraft,
	entities: string[],
	actions: Record<string, string>,
	toolPermissions: ToolPermissionConfig,
	endpoint: GuardrailEndpointDraft,
) {
	const provider = String(values.provider ?? ""),
		key = guardrail_provider_map[provider],
		params: Record<string, unknown> = { guardrail: key, mode: values.mode, default_on: values.default_on },
		result: Record<string, unknown> = { guardrail_name: values.guardrail_name, litellm_params: params, guardrail_info: {} };
	if (provider === "PresidioPII" && entities.length) {
		params.pii_entities_config = Object.fromEntries(entities.map((entity) => [entity, actions[entity] || "MASK"]));
		if (values.presidio_analyzer_api_base) params.presidio_analyzer_api_base = values.presidio_analyzer_api_base;
		if (values.presidio_anonymizer_api_base) params.presidio_anonymizer_api_base = values.presidio_anonymizer_api_base;
	}
	if (shouldRenderContentFilterConfigSettings(provider)) {
		const competitor = content.competitorConfig,
			hasCompetitor = content.competitorEnabled && Boolean(competitor?.brand_self?.length);
		if (!content.patterns.length && !content.keywords.length && !content.categories.length && !hasCompetitor)
			throw new GuardrailDraftError(
				"Please configure at least one content filter setting (category, pattern, keyword, or competitor intent)",
			);
		if (content.patterns.length)
			params.patterns = content.patterns.map((pattern) => ({
				pattern_type: pattern.type === "prebuilt" ? "prebuilt" : "regex",
				pattern_name: pattern.type === "prebuilt" ? pattern.name : undefined,
				pattern: pattern.type === "custom" ? pattern.pattern : undefined,
				name: pattern.name,
				action: pattern.action,
			}));
		if (content.keywords.length)
			params.blocked_words = content.keywords.map((word) => ({
				keyword: word.keyword,
				action: word.action,
				description: word.description,
			}));
		if (content.categories.length)
			params.categories = content.categories.map((category) => ({
				category: category.category,
				enabled: true,
				action: category.action,
				severity_threshold: category.severity_threshold || "medium",
			}));
		if (hasCompetitor && competitor)
			params.competitor_intent_config = {
				competitor_intent_type: competitor.competitor_intent_type ?? "airline",
				brand_self: competitor.brand_self,
				locations: competitor.locations?.length ? competitor.locations : undefined,
				competitors:
					competitor.competitor_intent_type === "generic" && competitor.competitors?.length ? competitor.competitors : undefined,
				policy: competitor.policy,
				threshold_high: competitor.threshold_high,
				threshold_medium: competitor.threshold_medium,
				threshold_low: competitor.threshold_low,
			};
	} else if (values.config) {
		try {
			result.guardrail_info = JSON.parse(String(values.config)) as unknown;
		} catch {
			throw new GuardrailDraftError("Invalid JSON in configuration");
		}
	}
	if (key === "tool_permission") {
		if (!toolPermissions.rules.length) throw new GuardrailDraftError("Add at least one tool permission rule");
		params.rules = toolPermissions.rules;
		params.default_action = toolPermissions.default_action;
		params.on_disallowed_action = toolPermissions.on_disallowed_action;
		if (toolPermissions.violation_message_template) params.violation_message_template = toolPermissions.violation_message_template;
	}
	if (shouldRenderContentFilterConfigSettings(provider)) {
		if (endpoint.endSessionAfterNFails !== undefined && endpoint.endSessionAfterNFails > 0)
			params.end_session_after_n_fails = endpoint.endSessionAfterNFails;
		if (endpoint.onViolation && endpoint.type === "realtime") params.on_violation = endpoint.onViolation;
		if (endpoint.message.trim()) params.realtime_violation_message = endpoint.message.trim();
	}
	if (providers && provider) {
		const fields = providers[key?.toLowerCase()] ?? {},
			allowed = new Set(Object.keys(fields).filter((name) => name !== "optional_params")),
			optional = fields.optional_params?.fields ?? {},
			nested =
				values.optional_params && typeof values.optional_params === "object"
					? (values.optional_params as Record<string, unknown>)
					: {};
		for (const name of Object.keys(optional)) allowed.add(name);
		for (const name of allowed) {
			let value = values[name];
			if (value === undefined || value === null || value === "") value = nested[name];
			if (value !== undefined && value !== null && value !== "") params[name] = value;
		}
	}
	return result;
}
