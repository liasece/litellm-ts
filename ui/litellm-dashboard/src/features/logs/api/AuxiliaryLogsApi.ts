import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { DeletedKeyFilters } from "../support/DeletedLogFilterModels";
const row = z.record(z.string(), z.unknown());
const deletedKeys = z
	.object({ keys: z.array(row), total_count: z.number(), current_page: z.number().optional(), total_pages: z.number().optional() })
	.passthrough();
const deletedTeams = z.union([z.array(row), z.object({ teams: z.array(row) }).passthrough()]);
export const auxiliaryLogsApi = {
	deletedKeys: (page: number, filters: Partial<DeletedKeyFilters> = {}, signal?: AbortSignal) => {
		const params = new URLSearchParams({
			page: String(page),
			size: "50",
			status: "deleted",
			return_full_object: "true",
			include_team_keys: "true",
			include_created_by_keys: "true",
		});
		for (const [name, value] of Object.entries(filters)) {
			const trimmed = value?.trim();
			if (trimmed) params.set(name, trimmed);
		}
		return requestJson("/key/list?" + params, { signal }, (value) => deletedKeys.parse(value));
	},
	deletedTeams: (signal?: AbortSignal) =>
		requestJson("/v2/team/list?" + new URLSearchParams({ page: "1", page_size: "100", status: "deleted" }), { signal }, (value) => {
			const data = deletedTeams.parse(value);
			return Array.isArray(data) ? data : data.teams;
		}),
};
