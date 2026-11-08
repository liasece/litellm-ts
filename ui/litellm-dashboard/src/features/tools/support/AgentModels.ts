export interface AgentSkill extends Record<string, unknown> {
	id?: string;
	name?: string;
	description?: string;
	tags?: string[] | string;
	examples?: string[];
}
export interface AgentCard extends Record<string, unknown> {
	name?: string;
	description?: string;
	url?: string;
	version?: string;
	protocolVersion?: string;
	capabilities?: { streaming?: boolean; pushNotifications?: boolean; stateTransitionHistory?: boolean };
	skills?: AgentSkill[];
	iconUrl?: string;
	documentationUrl?: string;
	defaultInputModes?: string[];
	defaultOutputModes?: string[];
	supportsAuthenticatedExtendedCard?: boolean;
}
export interface Agent extends Record<string, unknown> {
	agent_id: string;
	agent_name: string;
	litellm_params: Record<string, unknown> & { model?: string };
	agent_card_params?: AgentCard;
	object_permission?: {
		mcp_servers?: string[];
		mcp_access_groups?: string[];
		mcp_tool_permissions?: Record<string, string[]>;
		models?: string[];
		agents?: string[];
	};
	spend?: number;
	tpm_limit?: number | null;
	rpm_limit?: number | null;
	session_tpm_limit?: number | null;
	session_rpm_limit?: number | null;
	created_at?: string;
	updated_at?: string;
	static_headers?: Record<string, string>;
	extra_headers?: string[];
}
export interface AgentTypeField {
	key: string;
	label: string;
	placeholder?: string | null;
	tooltip?: string | null;
	required?: boolean;
	field_type?: "text" | "password" | "select" | "upload" | "textarea";
	options?: string[] | null;
	default_value?: string | null;
	include_in_litellm_params?: boolean;
}
export interface AgentTypeInfo {
	agent_type: string;
	agent_type_display_name: string;
	description?: string | null;
	logo_url?: string | null;
	credential_fields: AgentTypeField[];
	litellm_params_template?: Record<string, string> | null;
	model_template?: string | null;
	use_a2a_form_fields?: boolean;
}
export interface AgentKey {
	token: string;
	key_alias?: string | null;
	agent_id?: string;
}
export interface AgentFlowOptions {
	type: string;
	requireInbound: boolean;
	requireOutbound: boolean;
	maxIterations: number | null;
	maxBudget: number | null;
	keyOption: "create_new" | "existing_key" | "skip";
	keyName: string;
	keyModels: string[];
	existingKey: string | null;
}
export interface AgentEntitlements {
	mcp_servers: string[];
	mcp_access_groups: string[];
	mcp_tool_permissions: Record<string, string[]>;
	models: string[];
	agents: string[];
}
