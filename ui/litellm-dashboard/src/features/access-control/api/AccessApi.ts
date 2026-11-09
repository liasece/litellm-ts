import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import { parseOrganization, parseOrganizations, parseTeam, parseTeams, parseUser, parseUsers, recordSchema } from "./AccessApiSchemas";
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
	team: (id: string, signal?: AbortSignal) => requestJson(queryPath("/team/info", { team_id: id }), { signal }, parseTeam),
	createTeam: (body: AccessRecord) => mutate("/team/new", "POST", body),
	updateTeam: (body: AccessRecord) => mutate("/team/update", "POST", body),
	deleteTeam: (id: string) => mutate("/team/delete", "POST", { team_ids: [id] }),
	addTeamMember: (id: string, member: AccessMember) => mutate("/team/member_add", "POST", { team_id: id, member }),
	deleteTeamMember: (id: string, member: AccessMember) =>
		mutate("/team/member_delete", "POST", {
			team_id: id,
			...(member.user_id ? { user_id: member.user_id } : {}),
			...(member.user_email ? { user_email: member.user_email } : {}),
		}),
	organizations: (params: Record<string, string | null | undefined> = {}, signal?: AbortSignal) =>
		requestJson(queryPath("/organization/list", params), { signal }, parseOrganizations),
	organization: (id: string, signal?: AbortSignal) =>
		requestJson(queryPath("/organization/info", { organization_id: id }), { signal }, parseOrganization),
	createOrganization: (body: AccessRecord) => mutate("/organization/new", "POST", body),
	updateOrganization: (body: AccessRecord) => mutate("/organization/update", "PATCH", body),
	deleteOrganization: (id: string) => mutate("/organization/delete", "DELETE", { organization_ids: [id] }),
	addOrganizationMember: (id: string, member: AccessMember) =>
		mutate("/organization/member_add", "POST", { organization_id: id, member }),
	deleteOrganizationMember: (id: string, userId: string) =>
		mutate("/organization/member_delete", "DELETE", { organization_id: id, user_id: userId }),
	users: (params: Record<string, string | number | null | undefined> = {}, signal?: AbortSignal) =>
		requestJson(queryPath("/user/list", params), { signal }, (v) => pagination<AccessUser>(v, "users", parseUsers)),
	user: (id: string, signal?: AbortSignal) =>
		requestJson(queryPath("/user/info", { user_id: id }), { signal }, (value) => {
			const response = recordSchema.parse(value);
			return parseUser(response.user_info ?? value);
		}),
	createUser: (body: AccessRecord) => mutate("/user/new", "POST", { user_id: null, ...body, auto_create_key: false }),
	updateUser: (body: AccessRecord) => mutate("/user/update", "POST", body),
	deleteUsers: (ids: string[]) => mutate("/user/delete", "POST", { user_ids: ids }),
};
export type AccessApi = typeof accessApi;
