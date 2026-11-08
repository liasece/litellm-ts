/**
 * Shared configuration for agent form fields
 * Used across create, view, and update operations
 */

export interface FieldConfig {
	name: string;
	label: string;
	type: "text" | "textarea" | "url" | "switch" | "list";
	required?: boolean;
	tooltip?: string;
	placeholder?: string;
	defaultValue?: unknown;
	rows?: number;
	validation?: unknown[];
}

export interface SectionConfig {
	key: string;
	title: string;
	fields: FieldConfig[];
	defaultExpanded?: boolean;
}

export const AGENT_FORM_CONFIG: {
	basic: SectionConfig;
	skills: SectionConfig;
	capabilities: SectionConfig;
	optional: SectionConfig;
	litellm: SectionConfig;
	cost: SectionConfig;
	tracing: SectionConfig;
} = {
	basic: {
		key: "basic",
		title: "Basic Information",
		defaultExpanded: true,
		fields: [
			{
				name: "name",
				label: "Display Name",
				type: "text",
				required: true,
				placeholder: "e.g., Customer Support Agent",
			},
			{
				name: "description",
				label: "Description",
				type: "textarea",
				required: true,
				placeholder: "Describe what this agent does...",
				rows: 3,
			},
			{
				name: "url",
				label: "URL",
				type: "url",
				required: false,
				placeholder: "http://localhost:9999/",
				tooltip: "Base URL where the agent is hosted (optional)",
			},
			{
				name: "version",
				label: "Version",
				type: "text",
				placeholder: "1.0.0",
				defaultValue: "1.0.0",
			},
			{
				name: "protocolVersion",
				label: "Protocol Version",
				type: "text",
				placeholder: "1.0",
				defaultValue: "1.0",
			},
		],
	},
	skills: {
		key: "skills",
		title: "Skills",
		fields: [
			{
				name: "skills",
				label: "Skills",
				type: "list",
				defaultValue: [],
			},
		],
	},
	capabilities: {
		key: "capabilities",
		title: "Capabilities",
		fields: [
			{
				name: "streaming",
				label: "Streaming",
				type: "switch",
				defaultValue: false,
			},
			{
				name: "pushNotifications",
				label: "Push Notifications",
				type: "switch",
			},
			{
				name: "stateTransitionHistory",
				label: "State Transition History",
				type: "switch",
			},
		],
	},
	optional: {
		key: "optional",
		title: "Optional Settings",
		fields: [
			{
				name: "iconUrl",
				label: "Icon URL",
				type: "url",
				placeholder: "https://example.com/icon.png",
			},
			{
				name: "documentationUrl",
				label: "Documentation URL",
				type: "url",
				placeholder: "https://docs.example.com",
			},
			{
				name: "supportsAuthenticatedExtendedCard",
				label: "Supports Authenticated Extended Card",
				type: "switch",
			},
		],
	},
	litellm: {
		key: "litellm",
		title: "LiteLLM Parameters",
		fields: [
			{
				name: "model",
				label: "Model (Optional)",
				type: "text",
			},
			{
				name: "make_public",
				label: "Make Public",
				type: "switch",
			},
		],
	},
	cost: {
		key: "cost",
		title: "Cost Configuration",
		fields: [
			{
				name: "cost_per_query",
				label: "Cost Per Query ($)",
				type: "text",
				placeholder: "0.0",
				tooltip: "Fixed cost per query",
			},
			{
				name: "input_cost_per_token",
				label: "Input Cost Per Token ($)",
				type: "text",
				placeholder: "0.000001",
				tooltip: "Cost per input token",
			},
			{
				name: "output_cost_per_token",
				label: "Output Cost Per Token ($)",
				type: "text",
				placeholder: "0.000002",
				tooltip: "Cost per output token",
			},
		],
	},
	tracing: {
		key: "tracing",
		title: "Tracing",
		fields: [
			{
				name: "enable_tracing",
				label: "Enable Tracing",
				type: "switch",
				defaultValue: false,
				tooltip: "Enable request tracing for this agent",
			},
		],
	},
};

export const SKILL_FIELD_CONFIG = {
	id: {
		name: "id",
		label: "Skill ID",
		required: true,
		placeholder: "e.g., hello_world",
	},
	name: {
		name: "name",
		label: "Skill Name",
		required: true,
		placeholder: "e.g., Returns hello world",
	},
	description: {
		name: "description",
		label: "Description",
		required: true,
		placeholder: "What this skill does",
		rows: 2,
	},
	tags: {
		name: "tags",
		label: "Tags (comma-separated)",
		required: true,
		placeholder: "e.g., hello world, greeting",
	},
	examples: {
		name: "examples",
		label: "Examples (comma-separated)",
		placeholder: "e.g., hi, hello world",
	},
};
