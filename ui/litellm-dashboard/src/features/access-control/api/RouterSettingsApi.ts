import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
export const routerFieldSchema = z
	.object({
		field_name: z.string(),
		ui_field_name: z.string().optional(),
		field_description: z.string().optional(),
		options: z.array(z.string()).nullish(),
		link: z.string().nullish(),
	})
	.passthrough();
export function loadRouterSettings() {
	return requestJson("/router/settings", {}, (value) =>
		z
			.object({
				fields: z.array(routerFieldSchema),
				current_values: z.record(z.string(), z.unknown()).optional(),
				routing_strategy_descriptions: z.record(z.string(), z.string()).optional(),
			})
			.passthrough()
			.parse(value),
	);
}
export type RouterField = z.infer<typeof routerFieldSchema>;
