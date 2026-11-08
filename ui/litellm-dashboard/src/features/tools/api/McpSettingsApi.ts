import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown());
export const mcpSettingsApi = {
	generalRaw: () => requestJson<unknown>("/config/list?config_type=general_settings"),
	general: () =>
		requestJson("/config/list?config_type=general_settings", undefined, (value) =>
			z.array(z.object({ field_name: z.string(), field_value: z.unknown() }).passthrough()).parse(value),
		),
	update: (field: string, value: unknown) =>
		requestJson("/config/field/update", {
			method: "POST",
			body: JSON.stringify({ field_name: field, field_value: value, config_type: "general_settings" }),
		}),
	reset: (field: string) =>
		requestJson("/config/field/delete", {
			method: "POST",
			body: JSON.stringify({ field_name: field, config_type: "general_settings" }),
		}),
	semantic: () =>
		requestJson("/get/mcp_semantic_filter_settings", undefined, (value) =>
			z
				.object({ values: record.optional().default({}), field_schema: record.optional() })
				.passthrough()
				.parse(value),
		),
	saveSemantic: (value: Record<string, unknown>) =>
		requestJson("/update/mcp_semantic_filter_settings", { method: "PATCH", body: JSON.stringify(value) }),
};
