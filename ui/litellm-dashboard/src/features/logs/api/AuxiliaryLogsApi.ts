import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const row = z.record(z.string(), z.unknown());
const deletedKeys = z
	.object({ keys: z.array(row), total_count: z.number(), current_page: z.number().optional(), total_pages: z.number().optional() })
	.passthrough();
const deletedTeams = z.union([z.array(row), z.object({ teams: z.array(row) }).passthrough()]);
export const auditEntrySchema = z
	.object({
		id: z.string(),
		updated_at: z.string(),
		changed_by: z.string().nullish(),
		changed_by_api_key: z.string().nullish(),
		action: z.string(),
		table_name: z.string(),
		object_id: z.string(),
		before_value: row.nullish(),
		updated_values: row.nullish(),
	})
	.passthrough();
export type AuditLogEntry = z.infer<typeof auditEntrySchema>;
export const auxiliaryLogsApi = {
	deletedKeys: (page: number, signal?: AbortSignal) =>
		requestJson(
			"/key/list?" +
				new URLSearchParams({
					page: String(page),
					size: "50",
					status: "deleted",
					return_full_object: "true",
					include_team_keys: "true",
					include_created_by_keys: "true",
				}),
			{ signal },
			(value) => deletedKeys.parse(value),
		),
	deletedTeams: (signal?: AbortSignal) =>
		requestJson("/v2/team/list?" + new URLSearchParams({ page: "1", page_size: "100", status: "deleted" }), { signal }, (value) => {
			const data = deletedTeams.parse(value);
			return Array.isArray(data) ? data : data.teams;
		}),
	audit: (params: URLSearchParams, signal?: AbortSignal) =>
		requestJson("/audit?" + params, { signal }, (value) =>
			z
				.object({ audit_logs: z.array(auditEntrySchema), total: z.number(), total_pages: z.number().optional() })
				.passthrough()
				.parse(value),
		),
};
