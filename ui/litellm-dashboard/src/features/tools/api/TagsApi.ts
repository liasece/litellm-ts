import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { ToolTag } from "../support/TagModels";
const tagSchema = z
	.object({
		name: z.string(),
		models: z
			.array(z.string())
			.nullish()
			.transform((value) => value ?? []),
		created_at: z.string(),
		updated_at: z.string(),
	})
	.passthrough();
function parseTags(value: unknown): ToolTag[] {
	if (Array.isArray(value)) return z.array(tagSchema).parse(value) as ToolTag[];
	return Object.values(z.record(z.string(), tagSchema).parse(value)) as ToolTag[];
}
export const tagsApi = {
	list: (signal?: AbortSignal) => requestJson("/tag/list", { signal }, parseTags),
	detail: (name: string, signal?: AbortSignal) =>
		requestJson("/tag/info", { method: "POST", body: JSON.stringify({ names: [name] }), signal }, (value) => {
			const tags = z.record(z.string(), tagSchema).parse(value);
			const result = tags[name];
			if (!result) throw new Error("Tag not found");
			return result as ToolTag;
		}),
	create: (body: Record<string, unknown>) => requestJson("/tag/new", { method: "POST", body: JSON.stringify(body) }),
	update: (body: Record<string, unknown>) => requestJson("/tag/update", { method: "POST", body: JSON.stringify(body) }),
	delete: (name: string) => requestJson("/tag/delete", { method: "POST", body: JSON.stringify({ name }) }),
};
export function tagModels() {
	return requestJson("/v2/model/info?include_team_models=true&page=1&size=50", {}, (value) =>
		z
			.object({
				data: z.array(z.object({ model_name: z.string(), model_info: z.object({ id: z.string() }).passthrough() }).passthrough()),
			})
			.passthrough()
			.parse(value)
			.data.map((model) => ({ value: model.model_info.id, label: model.model_name + " (" + model.model_info.id + ")" })),
	);
}
export function tagEditModels() {
	return requestJson("/models?include_model_access_groups=True", {}, (value) =>
		z
			.object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
			.passthrough()
			.parse(value)
			.data.map((model) => ({ value: model.id, label: model.id })),
	);
}
