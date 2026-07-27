export interface ModelGroupInfo {
	model_group: string;
	providers: string[];
	max_input_tokens?: number;
	max_output_tokens?: number;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	mode?: string;
	tpm?: number;
	rpm?: number;
	supports_parallel_function_calling: boolean;
	supports_vision: boolean;
	supports_function_calling: boolean;
	supported_openai_params?: string[];
	is_public_model_group: boolean;
	[key: string]: unknown;
}
