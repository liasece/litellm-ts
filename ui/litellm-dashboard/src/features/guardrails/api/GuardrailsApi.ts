import { z } from "zod";
import { dashboardFetch, getApiBaseUrl, requestJson } from "../../platform/api/HttpApiClient";
import type { GuardrailRecord, GuardrailProviderParameters, GuardrailUiSettings } from "../support/GuardrailModels";
const record = z.record(z.string(), z.unknown()),
	guardrail = z
		.object({
			guardrail_id: z.string().optional(),
			guardrail_name: z.string().nullable(),
			litellm_params: z
				.object({
					guardrail: z.string(),
					mode: z.union([z.string(), z.array(z.string())]),
					default_on: z.boolean(),
					pii_entities_config: record.optional(),
				})
				.passthrough(),
			guardrail_info: record.nullable(),
			created_at: z.string().optional(),
			updated_at: z.string().optional(),
			guardrail_definition_location: z.string().optional(),
		})
		.passthrough();
async function raw(path: string, init: RequestInit = {}) {
	const response = await dashboardFetch(getApiBaseUrl() + path, { headers: { "Content-Type": "application/json" }, ...init });
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as unknown;
}
export const guardrailsApi = {
	airlines: () =>
		requestJson(
			"/guardrails/ui/major_airlines",
			{},
			(value) =>
				z
					.object({ airlines: z.array(z.object({ id: z.string(), match: z.string(), tags: z.array(z.string()) }).passthrough()) })
					.parse(value).airlines,
		),
	list: async (signal?: AbortSignal): Promise<GuardrailRecord[]> => {
		let value: unknown;
		try {
			value = await raw("/v2/guardrails/list", { signal });
		} catch {
			value = await raw("/guardrails/list", { signal });
		}
		return z
			.object({ guardrails: z.array(guardrail) })
			.passthrough()
			.parse(value).guardrails as GuardrailRecord[];
	},
	detail: (id: string, signal?: AbortSignal) =>
		requestJson("/guardrails/" + encodeURIComponent(id) + "/info", { signal }, (value) => guardrail.parse(value) as GuardrailRecord),
	create: (body: Record<string, unknown>) => raw("/guardrails", { method: "POST", body: JSON.stringify({ guardrail: body }) }),
	update: (id: string, body: Record<string, unknown>) =>
		raw("/guardrails/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) }),
	delete: (id: string) => raw("/guardrails/" + encodeURIComponent(id), { method: "DELETE" }),
	providers: (signal?: AbortSignal) =>
		requestJson(
			"/guardrails/ui/provider_specific_params",
			{ signal },
			(value) => z.record(z.string(), record).parse(value) as GuardrailProviderParameters,
		),
	settings: (signal?: AbortSignal) =>
		requestJson(
			"/guardrails/ui/add_guardrail_settings",
			{ signal },
			(value) =>
				z
					.object({
						supported_entities: z.array(z.string()).optional().default([]),
						supported_actions: z.array(z.string()).optional().default([]),
						supported_modes: z.array(z.string()).optional(),
						pii_entity_categories: z
							.array(z.object({ category: z.string(), entities: z.array(z.string()) }))
							.optional()
							.default([]),
						content_filter_settings: z
							.object({
								prebuilt_patterns: z.array(
									z.object({ name: z.string(), display_name: z.string(), category: z.string(), description: z.string() }),
								),
								pattern_categories: z.array(z.string()),
								supported_actions: z.array(z.string()).optional().default([]),
								content_categories: z
									.array(
										z.object({
											name: z.string(),
											display_name: z.string(),
											description: z.string(),
											default_action: z.string(),
										}),
									)
									.optional(),
							})
							.optional(),
					})
					.passthrough()
					.parse(value) as GuardrailUiSettings,
		),
	category: (name: string) =>
		requestJson("/guardrails/ui/category_yaml/" + encodeURIComponent(name), {}, (value) =>
			z.object({ yaml_content: z.string(), file_type: z.string().optional() }).passthrough().parse(value),
		),
	validateKeywords: (content: string) =>
		raw("/guardrails/validate_blocked_words_file", { method: "POST", body: JSON.stringify({ file_content: content }) }).then((value) =>
			z
				.object({
					valid: z.boolean(),
					message: z.string().optional(),
					error: z.string().optional(),
					errors: z.array(z.string()).optional(),
				})
				.passthrough()
				.parse(value),
		),
};
