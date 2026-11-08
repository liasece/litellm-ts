import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const agent = z
	.object({
		model_name: z.string(),
		litellm_params: z
			.object({
				model: z.string(),
				litellm_system_prompt: z.string().optional(),
				tools: z.array(z.record(z.string(), z.unknown())).optional(),
				temperature: z.number().optional(),
				max_tokens: z.number().optional(),
			})
			.passthrough(),
		model_info: z.record(z.string(), z.unknown()).nullish(),
	})
	.passthrough();
export type AgentModel = z.infer<typeof agent>;
export const agentBuilderApi = {
	async list(signal?: AbortSignal) {
		const response = await requestJson("/v2/model/info?include_team_models=true&page=1&size=200", { signal }, (value) =>
			z.object({ data: z.array(z.unknown()) }).parse(value),
		);
		return response.data
			.flatMap((value) => {
				const parsed = agent.safeParse(value);
				return parsed.success && parsed.data.litellm_params.model.startsWith("litellm_agent/") ? [parsed.data] : [];
			})
			.sort((a, b) => a.model_name.localeCompare(b.model_name));
	},
	create(body: Record<string, unknown>) {
		return requestJson<unknown>("/model/new", { method: "POST", body: JSON.stringify(body) });
	},
	update(id: string, body: Record<string, unknown>) {
		return requestJson<unknown>("/model/" + encodeURIComponent(id) + "/update", { method: "PATCH", body: JSON.stringify(body) });
	},
	remove(id: string) {
		return requestJson<unknown>("/model/delete", { method: "POST", body: JSON.stringify({ id }) });
	},
	key(userId: string, model: string) {
		return requestJson(
			"/key/generate",
			{ method: "POST", body: JSON.stringify({ user_id: userId, models: [model], key_alias: "Agent: " + model }) },
			(value) => z.object({ key: z.string().nullish() }).passthrough().parse(value),
		);
	},
};
