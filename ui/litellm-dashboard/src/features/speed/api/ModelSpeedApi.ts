import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const point = z.object({ bucket: z.string(), avg_tps: z.number().finite(), p50_tps: z.number().finite(), requests: z.number() });
const report = z
	.object({
		start_date: z.string(),
		end_date: z.string(),
		bucket: z.enum(["hour", "day"]),
		timezone: z.string(),
		min_output_tokens: z.number(),
		min_bucket_requests: z.number(),
		buckets: z.array(z.string()),
		models: z.array(
			z.object({
				model: z.string(),
				provider: z.string(),
				calls: z.number(),
				requests: z.number(),
				avg_tps: z.number().finite(),
				p50_tps: z.number().finite(),
				points: z.array(point),
			}),
		),
		models_without_speed: z.array(z.object({ model: z.string(), provider: z.string(), calls: z.number() })),
	})
	.passthrough();
export function modelSpeed(query: { startDate: string; endDate: string; timezone: string }, signal?: AbortSignal) {
	const search = new URLSearchParams({ start_date: query.startDate, end_date: query.endDate, timezone: query.timezone });
	return requestJson("/global/model_speed?" + search, { signal, headers: { "Content-Type": "application/json" } }, (data) =>
		report.parse(data),
	);
}
