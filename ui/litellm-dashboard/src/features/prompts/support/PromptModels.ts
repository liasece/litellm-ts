import type { PlaygroundResponseUsage } from "../../playground/support/PlaygroundResponseMetricsModels";
export interface PromptMessage {
	role: string;
	content: string;
}
export interface PromptTool {
	name: string;
	description: string;
	json: string;
}
export interface PromptDraft {
	name: string;
	model: string;
	config: { temperature?: number; max_tokens?: number; top_p?: number };
	tools: PromptTool[];
	developerMessage: string;
	messages: PromptMessage[];
}
export interface PromptParameters extends Record<string, unknown> {
	prompt_id?: string;
	dotprompt_content?: string;
	prompt_data?: Record<string, unknown>;
	model?: string;
}
export interface PromptSpec extends Record<string, unknown> {
	prompt_id: string;
	litellm_params?: PromptParameters | null;
	prompt_info?: ({ prompt_type?: string } & Record<string, unknown>) | null;
	created_at?: string | null;
	updated_at?: string | null;
	version?: number | null;
}
export interface PromptTemplate {
	litellm_prompt_id: string;
	content: string;
	metadata?: Record<string, unknown> | null;
}
export interface PromptInfoResponse extends Record<string, unknown> {
	prompt_spec: PromptSpec;
	raw_prompt_template: PromptTemplate | null;
}
export interface PromptModelGroup extends Record<string, unknown> {
	model_group: string;
	providers: string[];
}
export interface PromptConversationMessage extends PromptMessage {
	model?: string;
	usage?: PlaygroundResponseUsage;
	timeToFirstToken?: number;
	totalLatency?: number;
}
