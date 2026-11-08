import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { ModelGroupChoice } from "../support/ModelSelectionModels";
export async function fetchModelGroupChoices(signal?: AbortSignal): Promise<ModelGroupChoice[]> {
	return requestJson("/model_group/info", { signal }, (value) =>
		z
			.object({
				data: z.array(
					z
						.object({ model_group: z.string(), mode: z.string().optional(), providers: z.array(z.string()).optional() })
						.passthrough(),
				),
			})
			.parse(value)
			.data.sort((a, b) => a.model_group.localeCompare(b.model_group)),
	);
}
