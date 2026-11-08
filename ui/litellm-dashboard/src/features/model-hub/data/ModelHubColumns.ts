import type { HubAgent, HubColumn, HubMcp, HubModel, HubPlugin } from "../support/ModelHubModels";
export function hubModelColumns(publicPage: boolean): HubColumn<HubModel>[] {
	if (publicPage)
		return [
			{ key: "model_group", label: "Model Name", sortable: true, width: 150 },
			{ key: "providers", label: "Providers", sortable: true, width: 120 },
			{ key: "mode", label: "Mode", sortable: true, width: 100 },
			{ key: "max_input_tokens", label: "Max Input", sortable: true, width: 100, align: "center", numeric: true },
			{ key: "max_output_tokens", label: "Max Output", sortable: true, width: 100, align: "center", numeric: true },
			{ key: "input_cost_per_token", label: "Input $/1M", sortable: true, width: 100, align: "center", numeric: true },
			{ key: "output_cost_per_token", label: "Output $/1M", sortable: true, width: 100, align: "center", numeric: true },
			{ key: "features", label: "Features", width: 120 },
			{ key: "health_status", label: "Health Status", sortable: true, width: 100 },
			{ key: "rpm", label: "Limits", sortable: true, width: 150, numeric: true },
		];
	return [
		{ key: "model_group", label: "Public Model Name", sortable: true },
		{ key: "providers", label: "Provider", sortable: true, hiddenBelow: "md" },
		{ key: "mode", label: "Mode", sortable: true, hiddenBelow: "lg" },
		{
			key: "max_input_tokens",
			label: "Tokens",
			sortable: true,
			hiddenBelow: "lg",
			numeric: true,
			compare: (a, b) =>
				(a.max_input_tokens || 0) + (a.max_output_tokens || 0) - (b.max_input_tokens || 0) - (b.max_output_tokens || 0),
		},
		{
			key: "input_cost_per_token",
			label: "Cost/1M",
			sortable: true,
			numeric: true,
			compare: (a, b) =>
				(a.input_cost_per_token || 0) +
				(a.output_cost_per_token || 0) -
				(b.input_cost_per_token || 0) -
				(b.output_cost_per_token || 0),
		},
		{ key: "features", label: "Features" },
		{
			key: "is_public_model_group",
			label: "Public",
			sortable: true,
			hiddenBelow: "md",
			compare: (a, b) => Number(a.is_public_model_group === true) - Number(b.is_public_model_group === true),
		},
		{ key: "details", label: "Details" },
	];
}
export function hubAgentColumns(publicPage: boolean): HubColumn<HubAgent>[] {
	if (publicPage)
		return [
			{ key: "name", label: "Agent Name", sortable: true, width: 150 },
			{ key: "description", label: "Description", width: 250 },
			{ key: "version", label: "Version", sortable: true, width: 80 },
			{ key: "provider", label: "Provider", width: 120 },
			{ key: "skills", label: "Skills", width: 150 },
			{ key: "capabilities", label: "Capabilities", width: 150 },
		];
	return [
		{ key: "name", label: "Agent Name", sortable: true },
		{ key: "description", label: "Description", sortable: true, hiddenBelow: "md" },
		{ key: "version", label: "Version", sortable: true, hiddenBelow: "lg" },
		{ key: "protocolVersion", label: "Protocol", sortable: true, hiddenBelow: "lg" },
		{ key: "skills", label: "Skills" },
		{ key: "capabilities", label: "Capabilities" },
		{ key: "defaultInputModes", label: "I/O Modes", hiddenBelow: "xl" },
		{
			key: "is_public",
			label: "Public",
			sortable: true,
			hiddenBelow: "md",
			compare: (a, b) => Number(a.is_public === true) - Number(b.is_public === true),
		},
		{ key: "details", label: "Details" },
	];
}
export function hubMcpColumns(publicPage: boolean): HubColumn<HubMcp>[] {
	if (publicPage)
		return [
			{ key: "server_name", label: "Server Name", sortable: true, width: 150 },
			{ key: "description", label: "Description", dataIndex: "mcp_info.description", width: 250 },
			{ key: "url", label: "URL", width: 200 },
			{ key: "transport", label: "Transport", sortable: true, width: 100 },
			{ key: "auth_type", label: "Auth Type", sortable: true, width: 100 },
		];
	return [
		{ key: "server_name", label: "Server Name", sortable: true },
		{ key: "description", label: "Description", sortable: true, hiddenBelow: "md" },
		{ key: "url", label: "URL", sortable: true, hiddenBelow: "lg" },
		{ key: "transport", label: "Transport", sortable: true, hiddenBelow: "md" },
		{ key: "auth_type", label: "Auth Type", sortable: true, hiddenBelow: "md" },
		{ key: "status", label: "Status", sortable: true },
		{ key: "allowed_tools", label: "Tools", hiddenBelow: "lg" },
		{ key: "created_by", label: "Created By", sortable: true, hiddenBelow: "xl" },
		{
			key: "is_public",
			label: "Public",
			sortable: true,
			hiddenBelow: "md",
			compare: (a, b) => Number(a.mcp_info.is_public === true) - Number(b.mcp_info.is_public === true),
		},
		{ key: "details", label: "Details" },
	];
}
export const hubMarketplaceColumns: HubColumn<HubPlugin>[] = [
	{ key: "name", label: "Plugin Name", sortable: true },
	{ key: "description", label: "Description", sortable: true, hiddenBelow: "md" },
	{ key: "version", label: "Version", sortable: true, hiddenBelow: "lg" },
	{ key: "category", label: "Category", sortable: true, hiddenBelow: "lg" },
	{ key: "source", label: "Source", hiddenBelow: "xl" },
	{ key: "keywords", label: "Keywords", hiddenBelow: "xl" },
	{ key: "install_command", label: "Install Command" },
];
