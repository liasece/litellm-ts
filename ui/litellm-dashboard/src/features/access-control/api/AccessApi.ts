import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import {
	parseBudgets,
	parseGroup,
	parseGroups,
	parseOrganization,
	parseOrganizations,
	parseProject,
	parseProjects,
	parseTeam,
	parseTeams,
	parseUser,
	parseUsers,
	recordSchema,
} from "./AccessApiSchemas";
import type { AccessMember, AccessRecord, AccessTeam, AccessUser, PageResult } from "../support/AccessModels";
export function queryPath(path: string, values: Record<string, string | number | null | undefined>): string {
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(values))
		if (value !== undefined && value !== null && value !== "") params.set(name, String(value));
	return path + (params.toString() ? "?" + params : "");
}
export function mutate(path: string, method: string, body: AccessRecord): Promise<unknown> {
	return requestJson(path, { method, body: JSON.stringify(body) });
}
function pagination<T>(value: unknown, key: string, parse: (input: unknown) => T[]): PageResult<T> {
	const response = recordSchema.parse(value),
		rows = parse(response[key]),
		total = z.number().parse(response.total);
	const page = z.number().optional().parse(response.page) ?? 1,
		pageSize = z.number().optional().parse(response.page_size) ?? 25;
	return { rows, total, page, pageSize, totalPages: z.number().optional().parse(response.total_pages) ?? Math.ceil(total / pageSize) };
}
export const accessApi = {
	teams: (params: Record<string, string | number | null | undefined> = {}, signal?: AbortSignal) =>
		requestJson(queryPath("/v2/team/list", params), { signal }, (v) => pagination<AccessTeam>(v, "teams", parseTeams)),
	allTeams: (signal?: AbortSignal) => requestJson("/team/list", { signal }, parseTeams),
	availableTeams: () => requestJson("/team/available", {}, parseTeams),
	team: (id: string, signal?: AbortSignal) => requestJson(queryPath("/team/info", { team_id: id }), { signal }, parseTeam),
	createTeam: (body: AccessRecord) => mutate("/team/new", "POST", body),
	updateTeam: (body: AccessRecord) => mutate("/team/update", "POST", body),
	deleteTeam: (id: string) => mutate("/team/delete", "POST", { team_ids: [id] }),
	addTeamMember: (id: string, member: AccessMember) => mutate("/team/member_add", "POST", { team_id: id, member }),
	updateTeamMember: (id: string, member: AccessMember) => {
		const body: AccessRecord = { team_id: id, role: member.role, user_id: member.user_id };
		if (member.user_email !== undefined) body.user_email = member.user_email;
		for (const field of ["max_budget_in_team", "tpm_limit", "rpm_limit"] as const)
			if (member[field] != null) body[field] = member[field];
		return mutate("/team/member_update", "POST", body);
	},
	deleteTeamMember: (id: string, member: AccessMember) =>
		mutate("/team/member_delete", "POST", {
			team_id: id,
			...(member.user_id ? { user_id: member.user_id } : {}),
			...(member.user_email ? { user_email: member.user_email } : {}),
		}),
	teamPermissions: (id: string) =>
		requestJson(queryPath("/team/permissions_list", { team_id: id }), {}, (value) =>
			z
				.object({
					all_available_permissions: z.array(z.string()).optional(),
					team_member_permissions: z.array(z.string()).optional(),
				})
				.passthrough()
				.parse(value),
		),
	updateTeamPermissions: (id: string, permissions: string[]) =>
		mutate("/team/permissions_update", "POST", { team_id: id, team_member_permissions: permissions }),
	organizations: (params: Record<string, string | null | undefined> = {}, signal?: AbortSignal) =>
		requestJson(queryPath("/organization/list", params), { signal }, parseOrganizations),
	organization: (id: string, signal?: AbortSignal) =>
		requestJson(queryPath("/organization/info", { organization_id: id }), { signal }, parseOrganization),
	createOrganization: (body: AccessRecord) => mutate("/organization/new", "POST", body),
	updateOrganization: (body: AccessRecord) => mutate("/organization/update", "PATCH", body),
	deleteOrganization: (id: string) => mutate("/organization/delete", "DELETE", { organization_ids: [id] }),
	addOrganizationMember: (id: string, member: AccessMember) =>
		mutate("/organization/member_add", "POST", { organization_id: id, member }),
	updateOrganizationMember: (id: string, member: AccessMember) =>
		mutate("/organization/member_update", "PATCH", { organization_id: id, ...member }),
	deleteOrganizationMember: (id: string, userId: string) =>
		mutate("/organization/member_delete", "DELETE", { organization_id: id, user_id: userId }),
	users: (params: Record<string, string | number | null | undefined> = {}, signal?: AbortSignal) =>
		requestJson(queryPath("/user/list", params), { signal }, (v) => pagination<AccessUser>(v, "users", parseUsers)),
	user: (id: string, signal?: AbortSignal) => requestJson(queryPath("/v2/user/info", { user_id: id }), { signal }, parseUser),
	createUser: (body: AccessRecord) => mutate("/user/new", "POST", { user_id: null, ...body, auto_create_key: false }),
	updateUser: (body: AccessRecord) => mutate("/user/update", "POST", body),
	deleteUsers: (ids: string[]) => mutate("/user/delete", "POST", { user_ids: ids }),
	bulkUpdateUsers: (body: AccessRecord, ids: string[], all = false) =>
		mutate(
			"/user/bulk_update",
			"POST",
			all ? { all_users: true, user_updates: body } : { users: ids.map((id) => ({ user_id: id, ...body })) },
		),
	bulkTeamMembers: (id: string, members: AccessMember[], budget: number | null, all = false) =>
		mutate("/team/bulk_member_add", "POST", {
			team_id: id,
			...(all ? { all_users: true } : { members }),
			...(budget != null ? { max_budget_in_team: budget } : {}),
		}),
	invite: (id: string) =>
		requestJson("/invitation/new", { method: "POST", body: JSON.stringify({ user_id: id }) }, (value) =>
			z.object({ id: z.string() }).passthrough().parse(value),
		),
	projects: (signal?: AbortSignal) => requestJson("/project/list", { signal }, parseProjects),
	project: (id: string, signal?: AbortSignal) => requestJson(queryPath("/project/info", { project_id: id }), { signal }, parseProject),
	createProject: (body: AccessRecord) => mutate("/project/new", "POST", body),
	updateProject: (id: string, body: AccessRecord) => mutate("/project/update", "POST", { project_id: id, ...body }),
	deleteProjects: (ids: string[]) => mutate("/project/delete", "DELETE", { project_ids: ids }),
	groups: (signal?: AbortSignal) => requestJson("/v1/access_group", { signal }, parseGroups),
	group: (id: string, signal?: AbortSignal) => requestJson("/v1/access_group/" + encodeURIComponent(id), { signal }, parseGroup),
	createGroup: (body: AccessRecord) => mutate("/v1/access_group", "POST", body),
	updateGroup: (id: string, body: AccessRecord) => mutate("/v1/access_group/" + encodeURIComponent(id), "PUT", body),
	deleteGroup: (id: string) => requestJson("/v1/access_group/" + encodeURIComponent(id), { method: "DELETE" }),
	budgets: (signal?: AbortSignal) => requestJson("/budget/list", { signal }, parseBudgets),
	createBudget: (body: AccessRecord) => mutate("/budget/new", "POST", body),
	updateBudget: (body: AccessRecord) => mutate("/budget/update", "POST", body),
	deleteBudget: (id: string) => mutate("/budget/delete", "POST", { id }),
	defaults: (kind: "team" | "user") =>
		requestJson(kind === "team" ? "/get/default_team_settings" : "/get/internal_user_settings", {}, (value) =>
			recordSchema.parse(value),
		),
	updateDefaults: (kind: "team" | "user", body: AccessRecord) =>
		mutate(kind === "team" ? "/update/default_team_settings" : "/update/internal_user_settings", "PATCH", body),
};
export type AccessApi = typeof accessApi;
