import { z } from "zod";
import { dashboardFetch, getApiBaseUrl } from "../../../platform/api/HttpApiClient";
const schema = z
	.object({ litellm_version: z.string().optional(), log_level: z.string().optional(), is_detailed_debug: z.boolean().optional() })
	.passthrough();
export type HealthReadiness = z.infer<typeof schema>;
export async function fetchHealthReadiness(signal?: AbortSignal): Promise<HealthReadiness> {
	const response = await dashboardFetch(getApiBaseUrl() + "/health/readiness", { signal });
	if (!response.ok) throw new Error("Failed to fetch health readiness: " + response.statusText);
	return schema.parse(await response.json());
}
