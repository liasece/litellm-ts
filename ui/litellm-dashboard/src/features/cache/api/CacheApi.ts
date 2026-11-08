import { z } from "zod";
import { dashboardFetch, getApiBaseUrl, requestJson } from "../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown());
const field = z
	.object({
		field_name: z.string(),
		field_type: z.string(),
		ui_field_name: z.string().optional(),
		field_description: z.string().optional(),
		field_default: z.unknown().optional(),
		redis_type: z.string().nullish(),
	})
	.passthrough();
const metadata = z
	.object({
		fields: z.array(field).default([]),
		current_values: record.default({}),
		redis_type_descriptions: z.record(z.string(), z.string()).default({}),
	})
	.passthrough();
export type CacheField = z.infer<typeof field>;
export type CacheMetadata = z.infer<typeof metadata>;
export const cacheApi = {
	activity: (from?: Date, to?: Date) => {
		const query =
			from && to
				? "?" + new URLSearchParams({ start_date: from.toISOString().split("T")[0], end_date: to.toISOString().split("T")[0] })
				: "";
		return requestJson("/global/activity/cache_hits" + query, {}, (value) => z.array(record).parse(value));
	},
	// The health panel mirrors the reference contract: a failed ping rejects with the
	// raw response body so the panel can unwrap the nested error payload.
	ping: async () => {
		const response = await dashboardFetch(getApiBaseUrl() + "/cache/ping", { headers: { "Content-Type": "application/json" } });
		if (!response.ok) throw new Error(await response.text());
		return record.parse(await response.json());
	},
	settings: () => requestJson("/cache/settings", {}, (value) => metadata.parse(value)),
	save: (values: Record<string, unknown>) =>
		requestJson("/cache/settings", { method: "POST", body: JSON.stringify({ cache_settings: values }) }),
	test: (values: Record<string, unknown>) =>
		requestJson("/cache/settings/test", { method: "POST", body: JSON.stringify({ cache_settings: values }) }, (value) =>
			record.parse(value),
		),
	models: () => requestJson("/model_group/info", {}, (value) => z.object({ data: z.array(record) }).parse(value).data),
};
