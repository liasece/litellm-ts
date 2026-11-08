export interface GuardrailParameters extends Record<string, unknown> {
	guardrail: string;
	mode: string | string[];
	default_on: boolean;
	pii_entities_config?: Record<string, unknown>;
}
export interface GuardrailRecord extends Record<string, unknown> {
	guardrail_id?: string;
	guardrail_name: string | null;
	litellm_params: GuardrailParameters;
	guardrail_info: Record<string, unknown> | null;
	created_at?: string;
	updated_at?: string;
	guardrail_definition_location?: string;
}
export interface ProviderParam extends Record<string, unknown> {
	param?: string;
	description?: string;
	required?: boolean;
	default_value?: unknown;
	options?: string[];
	type?: string;
	fields?: Record<string, ProviderParam>;
	dict_key_options?: string[];
	dict_value_type?: string;
	min?: number;
	max?: number;
	step?: number;
}
export interface ProviderParameterGroup {
	ui_friendly_name?: string;
	optional_params?: ProviderParam;
	[name: string]: ProviderParam | string | undefined;
}
export type GuardrailProviderParameters = Record<string, ProviderParameterGroup>;
export interface GuardrailPatternDefinition {
	name: string;
	display_name: string;
	category: string;
	description: string;
}
export interface GuardrailContentCategory {
	name: string;
	display_name: string;
	description: string;
	default_action: string;
}
export interface GuardrailUiSettings extends Record<string, unknown> {
	supported_entities: string[];
	supported_actions: string[];
	supported_modes?: string[];
	pii_entity_categories: { category: string; entities: string[] }[];
	content_filter_settings?: {
		prebuilt_patterns: GuardrailPatternDefinition[];
		pattern_categories: string[];
		supported_actions: string[];
		content_categories?: GuardrailContentCategory[];
	};
}
export type GuardrailAction = "BLOCK" | "MASK";
export interface GuardrailPattern {
	id: string;
	type: "prebuilt" | "custom";
	name: string;
	display_name?: string;
	pattern?: string;
	action: GuardrailAction;
}
export interface GuardrailKeyword {
	id: string;
	keyword: string;
	action: GuardrailAction;
	description?: string;
}
export interface SelectedGuardrailCategory {
	id: string;
	category: string;
	display_name: string;
	action: GuardrailAction;
	severity_threshold: "high" | "medium" | "low";
}
export interface CompetitorIntentConfig extends Record<string, unknown> {
	competitor_intent_type?: string;
	brand_self: string[];
	locations?: string[];
	competitors?: string[];
	policy?: { competitor_comparison?: string; possible_competitor_comparison?: string };
	threshold_high?: number;
	threshold_medium?: number;
	threshold_low?: number;
}
export interface GuardrailContentDraft {
	patterns: GuardrailPattern[];
	keywords: GuardrailKeyword[];
	categories: SelectedGuardrailCategory[];
	pendingCategory: string;
	competitorEnabled: boolean;
	competitorConfig: CompetitorIntentConfig | null;
}
export interface ToolPermissionRule extends Record<string, unknown> {
	id: string;
	tool_name?: string;
	tool_type?: string;
	decision: "allow" | "deny";
	allowed_param_patterns?: Record<string, string>;
}
export interface ToolPermissionConfig {
	rules: ToolPermissionRule[];
	default_action: string;
	on_disallowed_action: string;
	violation_message_template: string;
}
