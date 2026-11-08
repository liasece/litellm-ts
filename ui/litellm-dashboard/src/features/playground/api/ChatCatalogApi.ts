import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
export async function chatModels(signal?: AbortSignal) {
	const response = await requestJson("/model_group/info", { signal }, (value) =>
		z.object({ data: z.array(z.object({ model_group: z.string() }).passthrough()) }).parse(value),
	);
	return response.data
		.map((model) => model.model_group)
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}
