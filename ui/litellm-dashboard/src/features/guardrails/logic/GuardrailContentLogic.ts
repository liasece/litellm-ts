import type {
	GuardrailContentDraft,
	GuardrailRecord,
	GuardrailUiSettings,
	GuardrailAction,
	CompetitorIntentConfig,
} from "../support/GuardrailModels";
import { emptyGuardrailContent } from "./GuardrailCreateLogic";
import { guardrailRecord, guardrailStrings } from "../support/GuardrailClipboardSupport";
const records = (value: unknown) => (Array.isArray(value) ? value.map(guardrailRecord) : []);
const action = (value: unknown): GuardrailAction => (value === "MASK" ? "MASK" : "BLOCK");
export function contentFromGuardrail(record: GuardrailRecord, settings: GuardrailUiSettings | null): GuardrailContentDraft {
	const result = emptyGuardrailContent(),
		params = record.litellm_params;
	result.patterns = records(params.patterns).map((p, index) => ({
		id: "pattern-" + index,
		type: p.pattern_type === "prebuilt" ? "prebuilt" : "custom",
		name: String(p.pattern_name || p.name || ""),
		display_name: typeof p.display_name === "string" ? p.display_name : undefined,
		pattern: typeof p.pattern === "string" ? p.pattern : undefined,
		action: action(p.action),
	}));
	result.keywords = records(params.blocked_words).map((p, index) => ({
		id: "word-" + index,
		keyword: String(p.keyword ?? ""),
		description: typeof p.description === "string" ? p.description : undefined,
		action: action(p.action),
	}));
	const categories = new Map((settings?.content_filter_settings?.content_categories ?? []).map((item) => [item.name, item]));
	result.categories = records(params.categories).map((p, index) => ({
		id: "category-" + index,
		category: String(p.category),
		display_name: categories.get(String(p.category))?.display_name ?? String(p.category),
		action: action(p.action),
		severity_threshold: p.severity_threshold === "high" || p.severity_threshold === "low" ? p.severity_threshold : "medium",
	}));
	const config = guardrailRecord(params.competitor_intent_config);
	if (params.competitor_intent_config && typeof params.competitor_intent_config === "object") {
		result.competitorEnabled = guardrailStrings(config.brand_self).length > 0;
		result.competitorConfig = {
			competitor_intent_type: String(config.competitor_intent_type ?? "airline"),
			brand_self: guardrailStrings(config.brand_self),
			locations: guardrailStrings(config.locations),
			competitors: guardrailStrings(config.competitors),
			policy: (config.policy ?? {
				competitor_comparison: "refuse",
				possible_competitor_comparison: "reframe",
			}) as CompetitorIntentConfig["policy"],
			threshold_high: typeof config.threshold_high === "number" ? config.threshold_high : 0.7,
			threshold_medium: typeof config.threshold_medium === "number" ? config.threshold_medium : 0.45,
			threshold_low: typeof config.threshold_low === "number" ? config.threshold_low : 0.3,
		};
	}
	return result;
}
export function formatGuardrailContent(content: GuardrailContentDraft): Record<string, unknown> {
	const config = content.competitorConfig,
		result: Record<string, unknown> = {
			patterns: content.patterns.map((p) => ({
				pattern_type: p.type === "prebuilt" ? "prebuilt" : "regex",
				pattern_name: p.type === "prebuilt" ? p.name : undefined,
				pattern: p.type === "custom" ? p.pattern : undefined,
				name: p.name,
				action: p.action,
			})),
			blocked_words: content.keywords.map((w) => ({ keyword: w.keyword, action: w.action, description: w.description })),
			categories: content.categories.map((c) => ({
				category: c.category,
				enabled: true,
				action: c.action,
				severity_threshold: c.severity_threshold || "medium",
			})),
		};
	if (content.competitorEnabled && config && config.brand_self.length)
		result.competitor_intent_config = {
			competitor_intent_type: config.competitor_intent_type,
			brand_self: config.brand_self,
			locations: config.locations?.length ? config.locations : undefined,
			competitors: config.competitor_intent_type === "generic" && config.competitors?.length ? config.competitors : undefined,
			policy: config.policy,
			threshold_high: config.threshold_high,
			threshold_medium: config.threshold_medium,
			threshold_low: config.threshold_low,
		};
	return result;
}
