import { z } from "zod";
import { requestJson, dashboardFetch, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { readServerSentEvents } from "../../playground/api/PlaygroundTransportApi";
import type { PromptSpec, PromptInfoResponse, PromptModelGroup } from "../support/PromptModels";
const record = z.record(z.string(), z.unknown()),
	parameters = z
		.object({
			prompt_id: z.string().optional(),
			dotprompt_content: z.string().optional(),
			prompt_data: record.optional(),
			model: z.string().optional(),
		})
		.passthrough(),
	prompt = z
		.object({
			prompt_id: z.string(),
			litellm_params: parameters.nullish(),
			prompt_info: record.nullish(),
			created_at: z.string().nullish(),
			updated_at: z.string().nullish(),
			version: z.number().nullish(),
		})
		.passthrough();
// Keep the server's JSON field order for the raw-response view without bypassing schema validation.
function orderedJson(parsed: unknown, source: unknown): unknown {
	if (Array.isArray(parsed)) return parsed.map((item, index) => orderedJson(item, Array.isArray(source) ? source[index] : undefined));
	if (!parsed || typeof parsed !== "object") return parsed;
	const fields = parsed as Record<string, unknown>;
	const original = source && typeof source === "object" && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
	const keys = [
		...Object.keys(original).filter((key) => Object.hasOwn(fields, key)),
		...Object.keys(fields).filter((key) => !Object.hasOwn(original, key)),
	];
	return Object.fromEntries(keys.map((key) => [key, orderedJson(fields[key], original[key])]));
}
function parsePromptJson<T>(schema: z.ZodType<T>, value: unknown): T {
	return orderedJson(schema.parse(value), value) as T;
}
function list(value: unknown) {
	return parsePromptJson(z.object({ prompts: z.array(prompt) }).passthrough(), value).prompts as PromptSpec[];
}
export const promptsApi = {
	list: (signal?: AbortSignal) => requestJson("/prompts/list", { signal }, list),
	detail: (id: string, signal?: AbortSignal) =>
		requestJson(
			"/prompts/" + encodeURIComponent(id) + "/info",
			{ signal },
			(value) =>
				parsePromptJson(
					z
						.object({
							prompt_spec: prompt,
							raw_prompt_template: z
								.object({ litellm_prompt_id: z.string(), content: z.string(), metadata: record.nullish() })
								.passthrough()
								.nullable(),
						})
						.passthrough(),
					value,
				) as PromptInfoResponse,
		),
	versions: (id: string, signal?: AbortSignal) => requestJson("/prompts/" + encodeURIComponent(id) + "/versions", { signal }, list),
	create: (body: Record<string, unknown>) => requestJson("/prompts", { method: "POST", body: JSON.stringify(body) }),
	update: (id: string, body: Record<string, unknown>) =>
		requestJson("/prompts/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(body) }),
	delete: (id: string) => requestJson("/prompts/" + encodeURIComponent(id), { method: "DELETE" }),
	convert: (file: File) => {
		const body = new FormData();
		body.append("file", file);
		return requestJson("/utils/dotprompt_json_converter", { method: "POST", body }, (value) =>
			z.object({ prompt_id: z.string(), json_data: z.unknown() }).parse(value),
		);
	},
	modelHub: (signal?: AbortSignal) =>
		requestJson(
			"/model_group/info",
			{ signal },
			(value) =>
				z
					.object({
						data: z.array(
							z.object({ model_group: z.string(), providers: z.array(z.string()).optional().default([]) }).passthrough(),
						),
					})
					.parse(value).data as PromptModelGroup[],
		),
};
export async function* testPrompt(body: Record<string, unknown>, signal: AbortSignal, onReady?: () => void) {
	const response = await dashboardFetch(getApiBaseUrl() + "/prompts/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw new Error("HTTP error! status: " + response.status + ", " + (await response.text()));
	if (!response.body) throw new Error("No response body");
	onReady?.();
	yield* readServerSentEvents(response, signal, { skipMalformed: true });
}
