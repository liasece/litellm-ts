import type { UiTableColumn } from "../../platform/ui/UiTypes";
export interface HubModel extends Record<string, unknown> {
	model_group: string;
	providers: string[];
	mode?: string | null;
	max_input_tokens?: number | null;
	max_output_tokens?: number | null;
	input_cost_per_token?: number | null;
	output_cost_per_token?: number | null;
	tpm?: number | null;
	rpm?: number | null;
	is_public_model_group?: boolean;
	supported_openai_params?: string[];
	health_status?: string | null;
	health_response_time?: number | null;
	health_checked_at?: string | null;
}
export interface HubSkill {
	id: string;
	name: string;
	description: string;
	tags: string[];
	examples?: string[];
}
export interface HubAgent extends Record<string, unknown> {
	agent_id?: string;
	name: string;
	description: string;
	url: string;
	version: string;
	protocolVersion: string;
	capabilities: Record<string, unknown>;
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: HubSkill[];
	supportsAuthenticatedExtendedCard?: boolean;
	is_public?: boolean;
	iconUrl?: string;
	documentationUrl?: string;
	provider?: { organization: string; url: string };
}
export interface HubMcp extends Record<string, unknown> {
	server_id: string;
	server_name: string;
	name?: string;
	alias?: string | null;
	description?: string | null;
	url: string;
	transport: string;
	auth_type: string;
	status: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
	allowed_tools: string[];
	teams: string[];
	mcp_access_groups: string[];
	mcp_info: Record<string, unknown>;
	command?: string | null;
	last_health_check?: string | null;
	health_check_error?: string | null;
}
export type UsefulLinks = Record<string, string | { url: string; index?: number }>;
export interface HubInfo {
	custom_docs_description: string | null;
	litellm_version: string;
	useful_links: UsefulLinks;
}
export interface HubLink {
	id: string;
	displayName: string;
	url: string;
	index?: number;
}
export interface HubPlugin extends Record<string, unknown> {
	name: string;
	source: { source: "github" | "url"; repo?: string; url?: string };
	version?: string;
	description?: string;
	keywords?: string[];
	category?: string;
}
export interface HubMarketplace {
	name: string;
	owner: { name: string; email?: string };
	plugins: HubPlugin[];
}
export type HubPublishKind = "models" | "agents" | "mcp";
export interface HubPublishItem {
	url?: string;
	confirmationDescription?: string;
	id: string;
	name: string;
	public: boolean;
	description: string;
	badges: { label: string; color: string }[];
	extra?: string;
}
export interface HubColumn<T> extends UiTableColumn {
	hiddenBelow?: "md" | "lg" | "xl";
	compare?: (a: T, b: T) => number;
	numeric?: boolean;
}
