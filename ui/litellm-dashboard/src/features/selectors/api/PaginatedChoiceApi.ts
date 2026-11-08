import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const modelSchema = z
	.object({ model_name: z.string().nullish(), model_info: z.object({ id: z.string().nullish() }).passthrough().nullish() })
	.passthrough();
const modelsSchema = z
	.object({ data: z.array(modelSchema), current_page: z.number(), total_pages: z.number(), total_count: z.number().optional() })
	.passthrough();
const aliasesSchema = z.object({ aliases: z.array(z.string()), current_page: z.number(), total_pages: z.number() }).passthrough();
export interface PaginatedChoice {
	value: string;
	label: string;
	modelName?: string;
}
export interface ChoicePage {
	options: PaginatedChoice[];
	page: number;
	pages: number;
}
export type ChoiceKind = "model" | "key-alias";
export async function fetchChoicePage(
	kind: ChoiceKind,
	page: number,
	size: number,
	search: string,
	signal?: AbortSignal,
): Promise<ChoicePage> {
	const params = new URLSearchParams({ page: String(page), size: String(size) });
	if (search.trim()) params.set("search", kind === "model" ? search.trim() : search);
	if (kind === "model") {
		params.set("include_team_models", "true");
		const data = await requestJson("/v2/model/info?" + params, { signal }, (value) => modelsSchema.parse(value));
		return {
			options: data.data.flatMap((model) => {
				const id = model.model_info?.id;
				return id
					? [{ value: id, label: model.model_name ? model.model_name + " (" + id + ")" : id, modelName: model.model_name || "" }]
					: [];
			}),
			page: data.current_page,
			pages: data.total_pages,
		};
	}
	const data = await requestJson("/key/aliases?" + params, { signal }, (value) => aliasesSchema.parse(value));
	return {
		options: data.aliases.filter(Boolean).map((alias) => ({ value: alias, label: alias })),
		page: data.current_page,
		pages: data.total_pages,
	};
}
