import { z } from "zod";
import { requestJson } from "../../../platform/api/HttpApiClient";
const itemSchema = z
	.object({
		section: z.string(),
		key: z.string(),
		diff_kind: z.string(),
		yaml_value: z.unknown().optional(),
		db_value: z.unknown().optional(),
	})
	.passthrough();
const responseSchema = z.object({ has_pending: z.boolean(), items: z.array(itemSchema) });
export type YamlConfigDiffItem = z.infer<typeof itemSchema>;
export const yamlConfigDiffApi = {
	load: () => requestJson("/config/yaml_diff", {}, (value) => responseSchema.parse(value)),
	accept: (section: string, key: string) =>
		requestJson("/config/yaml_diff/accept", { method: "POST", body: JSON.stringify({ section, key }) }, () => undefined),
	resolve: () => requestJson("/config/yaml_diff/resolve", { method: "POST", body: JSON.stringify({}) }, () => undefined),
};
export type YamlConfigDiffApi = typeof yamlConfigDiffApi;
