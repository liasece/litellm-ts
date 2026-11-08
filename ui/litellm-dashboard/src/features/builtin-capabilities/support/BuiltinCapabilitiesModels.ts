export type CapabilityId = "vision" | "image_generation" | "web";
export interface ModelExecutor {
	type: "model";
	model: string;
	max_output_tokens?: number;
}
export interface DeepSeekExecutor {
	type: "deepseek_tools";
	api_base: string;
	credential_name: string;
	timeout_ms: number;
	search_count: number;
	search_need_content: boolean;
	localization: string;
}
export type CapabilityExecutor = ModelExecutor | DeepSeekExecutor;
export interface CapabilitySettings {
	enabled?: boolean;
	always_inject?: boolean;
	handler_model?: string;
	executors?: CapabilityExecutor[];
	max_iterations?: number | null;
	max_output_tokens?: number | null;
	[key: string]: unknown;
}
export type Capabilities = Record<CapabilityId, CapabilitySettings>;
export interface ModelCandidate {
	model_name: string;
	type: "model" | "alias";
	mode: string;
}
export interface BuiltinCapabilitiesResponse {
	capabilities: Capabilities;
	available_models: ModelCandidate[];
	image_generation_available_models: ModelCandidate[];
	web_available_models: ModelCandidate[];
}
export interface Choice {
	value: string;
	label: string;
}
