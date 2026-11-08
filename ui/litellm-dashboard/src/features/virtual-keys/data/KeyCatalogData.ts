import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import {
	emptyKeyCatalog,
	recordValue,
	selectedString,
	stringValues,
	type KeyCatalog,
	type KeyOrganization,
	type KeyProject,
	type KeyTeam,
} from "../support/VirtualKeyModels";
import type { UiSelectOption } from "../../platform/ui/UiTypes";

const recordSchema = z.record(z.string(), z.unknown());
function records(payload: unknown, keys: readonly string[] = []): Record<string, unknown>[] {
	if (Array.isArray(payload)) return payload.map((value) => recordSchema.parse(value));
	const object = recordSchema.parse(payload);
	for (const key of keys) if (Array.isArray(object[key])) return (object[key] as unknown[]).map((value) => recordSchema.parse(value));
	return Object.values(object)
		.filter((value) => value !== null && typeof value === "object" && !Array.isArray(value))
		.map((value) => recordSchema.parse(value));
}
function options(payload: unknown, keys: string[], id: string, label: string): UiSelectOption[] {
	return records(payload, keys)
		.filter((value) => value[id] != null)
		.map((value) => ({ value: selectedString(value[id]), label: selectedString(value[label]) || selectedString(value[id]) }));
}
async function optional(path: string): Promise<unknown> {
	try {
		return await requestJson(path);
	} catch {
		return [];
	}
}
export async function loadKeyCatalog(teamId?: string): Promise<KeyCatalog> {
	const teamQuery = teamId ? "?team_id=" + encodeURIComponent(teamId) : "";
	const [
		teams,
		organizations,
		projects,
		models,
		settings,
		agents,
		guardrails,
		policies,
		prompts,
		tags,
		vectorStores,
		accessGroups,
		mcp,
		mcpGroups,
		passthrough,
		callbacks,
		schema,
		roles,
	] = await Promise.all([
		optional("/team/list"),
		optional("/organization/list"),
		optional("/project/list"),
		optional(
			"/models?include_model_access_groups=True&return_wildcard_routes=True" +
				(teamId ? "&team_id=" + encodeURIComponent(teamId) : ""),
		),
		optional("/get/ui_settings"),
		optional("/v1/agents"),
		optional("/v2/guardrails/list").then(async (value) => (Array.isArray(value) ? optional("/guardrails/list") : value)),
		optional("/policies/list"),
		optional("/prompts/list"),
		optional("/tag/list"),
		optional("/vector_store/list"),
		optional("/v1/access_group"),
		optional("/v1/mcp/server" + teamQuery),
		optional("/v1/mcp/access_groups"),
		optional("/config/pass_through_endpoint" + (teamId ? "/team/" + encodeURIComponent(teamId) : "")),
		optional("/callbacks/configs"),
		optional("/openapi.json"),
		optional("/user/available_roles"),
	]);
	const result = emptyKeyCatalog();
	result.teams = records(teams, ["teams", "data"]).filter((team) => typeof team.team_id === "string") as KeyTeam[];
	result.organizations = records(organizations, ["organizations", "data"]).filter(
		(org) => typeof org.organization_id === "string",
	) as KeyOrganization[];
	result.projects = records(projects, ["projects", "data"]).filter((project) => typeof project.project_id === "string") as KeyProject[];
	result.models = records(models, ["data"])
		.map((model) => selectedString(model.id))
		.filter(Boolean);
	result.uiSettings = recordValue(recordValue(settings).values);
	result.guardrails = options(guardrails, ["guardrails"], "guardrail_name", "guardrail_name");
	result.policies = options(policies, ["policies"], "policy_name", "policy_name");
	result.prompts = options(prompts, ["prompts"], "prompt_id", "prompt_id");
	result.tags = options(tags, ["tags"], "name", "name");
	result.agents = options(agents, ["agents", "data"], "agent_id", "agent_name");
	result.agentGroups = [
		...new Set(
			records(agents, ["agents", "data"]).flatMap((agent) => stringValues(recordValue(agent.agent_card_params).access_groups)),
		),
	].map((value) => ({ value, label: value }));
	result.vectorStores = options(vectorStores, ["data"], "vector_store_id", "vector_store_name").map((option) => ({
		...option,
		label: option.label + " (" + option.value + ")",
	}));
	result.accessGroups = options(accessGroups, ["data"], "access_group_id", "access_group_name");
	result.mcpServers = options(mcp, ["servers", "data"], "server_id", "server_name").map((option) => ({
		...option,
		label: option.label + " (" + option.value + ")",
	}));
	result.mcpGroups = stringValues(recordValue(mcpGroups).access_groups).map((value) => ({ value, label: value }));
	result.passThroughRoutes = records(passthrough, ["endpoints"]).flatMap((endpoint) => {
		const path = selectedString(endpoint.path);
		const methods = stringValues(endpoint.methods);
		return (methods.length ? methods : [""]).map((method) => ({ value: path, label: method ? method + " " + path : path }));
	});
	result.callbacks = records(callbacks, ["callbacks"]);
	result.advancedProperties =
		(recordValue(recordValue(recordValue(recordValue(schema).components).schemas).GenerateKeyRequest)
			.properties as KeyCatalog["advancedProperties"]) || {};
	result.userRoles = recordValue(roles);
	return result;
}
export function searchKeyOwners(email: string, signal?: AbortSignal): Promise<UiSelectOption[]> {
	return requestJson("/user/filter/ui?user_email=" + encodeURIComponent(email), { signal }, (payload) =>
		records(payload, ["users", "data"]).map((user) => ({
			value: selectedString(user.user_id),
			label: selectedString(user.user_email) + " (" + selectedString(user.user_id) + ")",
		})),
	);
}
