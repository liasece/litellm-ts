import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown());
const schema = z
	.object({
		values: record,
		field_schema: z.object({ description: z.string().optional(), properties: z.record(z.string(), record).optional() }).optional(),
	})
	.passthrough();
export type UiSettingsResponse = z.infer<typeof schema>;
export const adminSettingsApi = {
	load: () => requestJson("/get/ui_settings", {}, (value) => schema.parse(value)),
	update: (values: Record<string, unknown>) => requestJson("/update/ui_settings", { method: "PATCH", body: JSON.stringify(values) }),
};
