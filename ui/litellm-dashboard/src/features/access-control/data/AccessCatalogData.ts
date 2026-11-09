import { loadKeyCatalog } from "../../virtual-keys/data/KeyCatalogData";
import { parseOrganizations, parseTeams } from "../api/AccessApiSchemas";
import { emptyAccessCatalog, type AccessCatalog } from "../support/AccessModels";
export async function loadAccessCatalog(teamId?: string): Promise<AccessCatalog> {
	const source = await loadKeyCatalog(teamId),
		result = emptyAccessCatalog();
	result.teams = parseTeams(source.teams);
	result.organizations = parseOrganizations(source.organizations);
	result.models = source.models.map((value) => ({ value, label: value }));
	for (const [key, value] of Object.entries(source.userRoles))
		if (value && typeof value === "object" && "ui_label" in value && typeof value.ui_label === "string")
			result.roles[key] = { ui_label: value.ui_label, description: "description" in value ? String(value.description) : undefined };
	return result;
}
