import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";

const membership = z.object({ user_id: z.string(), user_role: z.string().optional(), role: z.string().optional() });
const organization = z.object({
	organization_id: z.string(),
	organization_alias: z.string().nullish(),
	members: z
		.array(membership)
		.nullish()
		.transform((value) => value ?? []),
});
const team = z.object({
	team_id: z.string(),
	team_alias: z.string().nullish(),
	members_with_roles: z
		.array(membership)
		.nullish()
		.transform((value) => value ?? []),
});
const settings = z.object({
	enable_projects_ui: z.boolean().optional(),
	enabled_ui_pages_internal_users: z.array(z.string()).nullable().optional(),
	disable_agents_for_internal_users: z.boolean().optional(),
	allow_agents_for_team_admins: z.boolean().optional(),
	disable_vector_stores_for_internal_users: z.boolean().optional(),
	allow_vector_stores_for_team_admins: z.boolean().optional(),
});
const theme = z.object({ logo_url: z.string().nullable().optional(), favicon_url: z.string().nullable().optional() });
export const applicationApi = {
	settings: () => requestJson("/get/ui_settings", undefined, (value) => z.object({ values: settings }).parse(value).values),
	organizations: () => requestJson("/organization/list", undefined, (value) => z.array(organization).parse(value)),
	teams: () => requestJson("/team/list", undefined, (value) => z.array(team).parse(value)),
	theme: () => requestJson("/get/ui_theme_settings", undefined, (value) => z.object({ values: theme }).parse(value).values),
	proxySettings: () => requestJson("/sso/get/ui_settings", undefined, (value) => z.record(z.string(), z.unknown()).parse(value)),
};
