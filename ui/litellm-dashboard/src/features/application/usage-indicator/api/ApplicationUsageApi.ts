import { z } from "zod";
import { dashboardFetch, getApiBaseUrl } from "../../../platform/api/HttpApiClient";
import type { ApplicationUsageData, ApplicationLicenseInfo } from "../support/ApplicationUsageModels";
const count = z.number().nullable(),
	usage = z
		.object({
			total_users: count,
			total_users_used: z.number(),
			total_users_remaining: count,
			total_teams: count,
			total_teams_used: z.number(),
			total_teams_remaining: count,
		})
		.passthrough(),
	license = z
		.object({
			has_license: z.boolean(),
			license_type: z
				.string()
				.nullish()
				.transform((value) => value ?? null),
			expiration_date: z
				.string()
				.nullish()
				.transform((value) => value ?? null),
			allowed_features: z.array(z.string()).optional().default([]),
			limits: z.object({ max_users: count, max_teams: count }).optional().default({ max_users: null, max_teams: null }),
		})
		.passthrough();
async function get<T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T | null> {
	const response = await dashboardFetch(getApiBaseUrl() + path, { method: "GET", headers: {}, signal });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error("Network response was not ok");
	return parse(await response.json());
}
export const applicationUsageApi = {
	remaining: (signal?: AbortSignal) => get("/user/available_users", (value) => usage.parse(value) as ApplicationUsageData, signal),
	license: (signal?: AbortSignal) => get("/health/license", (value) => license.parse(value) as ApplicationLicenseInfo, signal),
};
