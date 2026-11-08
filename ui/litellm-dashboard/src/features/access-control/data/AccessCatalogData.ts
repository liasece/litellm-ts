import { loadKeyCatalog } from "../../virtual-keys/data/KeyCatalogData";
import { parseOrganizations, parseTeams } from "../api/AccessApiSchemas";
import { emptyAccessCatalog, type AccessCatalog, type ResourceOption } from "../support/AccessModels";
export async function loadAccessCatalog(teamId?: string): Promise<AccessCatalog> {
	const source = await loadKeyCatalog(teamId),
		result = emptyAccessCatalog();
	result.teams = parseTeams(source.teams);
	result.organizations = parseOrganizations(source.organizations);
	result.models = source.models.map((value) => ({ value, label: value }));
	const convert = (options: { value: string | number; label: string; description?: string }[]): ResourceOption[] =>
		options.map((option) => ({ ...option, value: String(option.value) }));
	result.guardrails = convert(source.guardrails);
	result.policies = convert(source.policies);
	result.groups = convert(source.accessGroups);
	result.mcpServers = convert(source.mcpServers);
	result.mcpGroups = convert(source.mcpGroups);
	result.agents = convert(source.agents);
	result.agentGroups = convert(source.agentGroups);
	result.vectorStores = convert(source.vectorStores);
	result.passthroughRoutes = convert(source.passThroughRoutes);
	for (const [key, value] of Object.entries(source.userRoles))
		if (value && typeof value === "object" && "ui_label" in value && typeof value.ui_label === "string")
			result.roles[key] = { ui_label: value.ui_label, description: "description" in value ? String(value.description) : undefined };
	return result;
}
