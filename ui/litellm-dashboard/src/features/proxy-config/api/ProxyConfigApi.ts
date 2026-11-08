import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const field = z
	.object({
		field_name: z.string(),
		field_value: z.unknown().optional(),
		field_description: z.string().optional(),
		field_type: z.string().optional(),
		stored_in_db: z.boolean().nullish(),
		field_default_value: z.unknown().optional(),
		premium_field: z.boolean().optional(),
		nested_fields: z.array(z.record(z.string(), z.unknown())).nullish(),
	})
	.passthrough();
export type ProxyConfigField = z.infer<typeof field>;
export const proxyConfigApi = {
	list: (type = "general_settings") =>
		requestJson("/config/list?" + new URLSearchParams({ config_type: type }), {}, (value) => z.array(field).parse(value)),
	update: (data: Record<string, unknown>) => requestJson("/config/update", { method: "POST", body: JSON.stringify(data) }),
	updateField: (type: string, name: string, value: unknown) =>
		requestJson("/config/field/update", {
			method: "POST",
			body: JSON.stringify({ config_type: type, field_name: name, field_value: value }),
		}),
	deleteField: (type: string, name: string) =>
		requestJson("/config/field/delete", { method: "POST", body: JSON.stringify({ config_type: type, field_name: name }) }),
};
