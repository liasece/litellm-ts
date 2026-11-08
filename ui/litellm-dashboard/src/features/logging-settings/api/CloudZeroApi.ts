import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown());
const settings = z
	.object({
		connection_id: z.string().nullish(),
		api_key_masked: z.string().nullish(),
		timezone: z.string().nullish(),
		status: z.string().optional(),
	})
	.passthrough();
export type CloudZeroSettings = z.infer<typeof settings>;
export const cloudZeroApi = {
	load: () =>
		requestJson("/cloudzero/settings", {}, (value) => {
			const parsed = settings.nullable().parse(value);
			return parsed && (parsed.api_key_masked || parsed.connection_id) ? parsed : null;
		}),
	create: (value: Record<string, string>) =>
		requestJson("/cloudzero/init", { method: "POST", body: JSON.stringify(value) }, (value) => record.parse(value)),
	update: (value: Record<string, string>) =>
		requestJson("/cloudzero/settings", { method: "PUT", body: JSON.stringify(value) }, (value) => record.parse(value)),
	remove: () => requestJson("/cloudzero/delete", { method: "DELETE" }),
	dryRun: () => requestJson("/cloudzero/dry-run", { method: "POST", body: JSON.stringify({ limit: 10 }) }),
	export: () => requestJson("/cloudzero/export", { method: "POST", body: JSON.stringify({ operation: "replace_hourly" }) }),
};
