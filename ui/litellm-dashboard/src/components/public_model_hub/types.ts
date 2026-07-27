export interface PublicModelInfo {
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
	health_status?: string;
	health_response_time?: number;
	health_checked_at?: string;
	[key: string]: unknown;
}

export interface PublicAgentCard {
	protocolVersion: string;
	name: string;
	description: string;
	url: string;
	version: string;
	capabilities?: {
		streaming?: boolean;
		pushNotifications?: boolean;
		stateTransitionHistory?: boolean;
	};
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: Array<{
		id: string;
		name: string;
		description: string;
		tags: string[];
	}>;
	iconUrl?: string;
	provider?: {
		organization: string;
		url: string;
	};
	documentationUrl?: string;
	[key: string]: unknown;
}

export interface PublicMcpServer {
	server_id: string;
	name: string;
	alias?: string | null;
	server_name: string;
	url: string;
	transport: string;
	spec_path?: string | null;
	auth_type: string;
	mcp_info: {
		server_name: string;
		description?: string;
		mcp_server_cost_info?: unknown;
	};
	[key: string]: unknown;
}

export type UsefulLinks = Record<
	string,
	string | { url: string; index: number }
>;

