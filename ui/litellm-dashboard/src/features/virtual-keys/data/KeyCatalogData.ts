import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import {
	emptyKeyCatalog,
	recordValue,
	selectedString,
	type KeyCatalog,
	type KeyOrganization,
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
async function optional(path: string): Promise<unknown> {
	try {
		return await requestJson(path);
	} catch {
		return [];
	}
}
export async function loadKeyCatalog(teamId?: string): Promise<KeyCatalog> {
	const [teams, organizations, models, settings, roles] = await Promise.all([
		optional("/team/list"),
		optional("/organization/list"),
		optional(
			"/models?include_model_access_groups=True&return_wildcard_routes=True" +
				(teamId ? "&team_id=" + encodeURIComponent(teamId) : ""),
		),
		optional("/get/ui_settings"),
		optional("/user/available_roles"),
	]);
	const result = emptyKeyCatalog();
	result.teams = records(teams, ["teams", "data"]).filter((team) => typeof team.team_id === "string") as KeyTeam[];
	result.organizations = records(organizations, ["organizations", "data"]).filter(
		(org) => typeof org.organization_id === "string",
	) as KeyOrganization[];
	result.models = records(models, ["data"])
		.map((model) => selectedString(model.id))
		.filter(Boolean);
	result.uiSettings = recordValue(recordValue(settings).values);
	result.userRoles = recordValue(roles);
	return result;
}
export function searchKeyOwners(email: string, signal?: AbortSignal): Promise<UiSelectOption[]> {
	return requestJson("/user/list?" + new URLSearchParams({ user_email: email, page: "1", page_size: "50" }), { signal }, (payload) =>
		records(payload, ["users", "data"]).map((user) => ({
			value: selectedString(user.user_id),
			label: selectedString(user.user_email) + " (" + selectedString(user.user_id) + ")",
		})),
	);
}
