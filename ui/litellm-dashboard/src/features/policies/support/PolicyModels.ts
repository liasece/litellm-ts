export type PipelineAction = "block" | "allow" | "next" | "modify_response";
export interface PipelineStep {
	guardrail: string;
	on_fail: PipelineAction;
	on_pass: PipelineAction;
	pass_data?: boolean;
	modify_response_message?: string | null;
}
export interface GuardrailPipeline {
	mode: "pre_call" | "post_call";
	steps: PipelineStep[];
}
export type PolicyVersionStatus = "draft" | "published" | "production";
export interface Policy {
	policy_id: string;
	policy_name: string;
	inherit: string | null;
	description: string | null;
	guardrails_add: string[];
	guardrails_remove: string[];
	condition: { model?: string | string[] } | null;
	pipeline?: GuardrailPipeline | null;
	version_number?: number;
	version_status?: PolicyVersionStatus;
	parent_version_id?: string | null;
	created_at?: string;
	updated_at?: string;
	created_by?: string;
	updated_by?: string;
}
export interface PolicyWrite {
	policy_name: string;
	description?: string;
	inherit?: string;
	guardrails_add: string[];
	guardrails_remove: string[];
	condition?: { model: string };
	pipeline?: GuardrailPipeline;
}
export interface PolicyAttachment {
	attachment_id: string;
	policy_name: string;
	scope: string | null;
	teams: string[];
	keys: string[];
	models: string[];
	tags: string[];
	created_at?: string;
	updated_at?: string;
	metadata?: Record<string, unknown> | null;
}
export interface AttachmentWrite {
	policy_name: string;
	scope?: string | null;
	teams?: string[];
	keys?: string[];
	models?: string[];
	tags?: string[];
}
export interface AttachmentImpact {
	affected_keys_count: number;
	affected_teams_count: number;
	sample_keys: string[];
	sample_teams: string[];
}
export interface PolicyContext {
	team_alias?: string;
	key_alias?: string;
	model?: string;
	tags?: string[];
}
export interface PolicyResolution {
	effective_guardrails: string[];
	matched_policies: { policy_name: string; matched_via: string; guardrails_added: string[] }[];
}
export interface PipelineStepResult {
	guardrail_name: string;
	outcome: "pass" | "fail" | "error";
	action_taken: string;
	modified_data: Record<string, unknown> | null;
	error_detail: string | null;
	duration_seconds: number | null;
}
export interface PipelineTestResult {
	terminal_action: string;
	step_results: PipelineStepResult[];
	modified_data?: Record<string, unknown> | null;
	error_message?: string | null;
	modify_response_message?: string | null;
}
export interface GuardrailDefinition extends Record<string, unknown> {
	guardrail_name: string;
	litellm_params?: { guardrail?: string; mode?: string | string[]; patterns?: unknown[]; categories?: unknown[]; [key: string]: unknown };
	guardrail_info?: { description?: string; [key: string]: unknown } | null;
}
export interface TemplateParameter {
	name: string;
	label: string;
	type: string;
	required: boolean;
	placeholder?: string;
}
export interface PolicyTemplate {
	id: string;
	title: string;
	description: string;
	icon?: string;
	iconColor?: string;
	iconBg?: string;
	guardrails: string[];
	tags: string[];
	inherits?: string;
	complexity: "Low" | "Medium" | "High";
	estimated_latency_ms?: number;
	parameters: TemplateParameter[];
	llm_enrichment?: { parameter: string; [key: string]: unknown };
	guardrailDefinitions: GuardrailDefinition[];
	templateData: Partial<Policy>;
	discoveredCompetitors?: string[];
}
export interface SuggestedTemplate {
	template_id: string;
	reason: string;
	template?: PolicyTemplate;
}
export interface EnrichmentResult {
	competitors: string[];
	competitor_variations: Record<string, string[]>;
	guardrailDefinitions: GuardrailDefinition[];
}
export interface TemplateTestEntry {
	guardrail_name: string;
	action: string;
	output_text: string;
	details: string;
}
export interface PolicyScopeOptions {
	teams: string[];
	keys: string[];
	models: string[];
}
export interface PolicySimpleForm {
	policy_name: string;
	description: string;
	inherit: string;
	guardrails_add: string[];
	guardrails_remove: string[];
	model_condition: string;
}
export interface AttachmentForm {
	policy_names: string[];
	teams: string[];
	keys: string[];
	models: string[];
	tags: string[];
}
