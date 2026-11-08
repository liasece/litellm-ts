import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { VectorStore, VectorResult, IngestResult } from "../support/VectorStoreModels";
const object = z.record(z.string(), z.unknown());
const store = z
	.object({
		vector_store_id: z.string(),
		custom_llm_provider: z.string(),
		vector_store_name: z.string().optional(),
		vector_store_description: z.string().optional(),
		vector_store_metadata: object.optional(),
		created_at: z.string(),
		updated_at: z.string(),
	})
	.passthrough();
const post = (path: string, body: Record<string, unknown>, signal?: AbortSignal) =>
	requestJson(path, { method: "POST", body: JSON.stringify(body), signal });
export const vectorStoresApi = {
	list: (signal: AbortSignal) =>
		requestJson(
			"/vector_store/list",
			{ signal },
			(value) => z.object({ data: z.array(store).optional().default([]) }).parse(value).data as VectorStore[],
		),
	detail: (id: string, signal: AbortSignal) =>
		requestJson(
			"/vector_store/info",
			{ method: "POST", body: JSON.stringify({ vector_store_id: id }), signal },
			(value) => z.object({ vector_store: store }).parse(value).vector_store as VectorStore,
		),
	create: (body: Record<string, unknown>) => post("/vector_store/new", body),
	update: (body: Record<string, unknown>) => post("/vector_store/update", body),
	delete: (id: string) => post("/vector_store/delete", { vector_store_id: id }),
	credentials: () =>
		requestJson(
			"/credentials",
			undefined,
			(value) =>
				z
					.object({
						credentials: z
							.array(z.object({ credential_name: z.string() }))
							.optional()
							.default([]),
					})
					.parse(value).credentials,
		),
	models: () =>
		requestJson("/model_group/info", undefined, (value) =>
			z
				.object({ data: z.array(z.object({ model_group: z.string(), mode: z.string().nullable().optional() })) })
				.parse(value)
				.data.sort((a, b) => a.model_group.localeCompare(b.model_group)),
		),
	search: (id: string, query: string) =>
		requestJson(
			"/v1/vector_stores/" + encodeURIComponent(id) + "/search",
			{ method: "POST", body: JSON.stringify({ query }) },
			(value) =>
				z
					.object({
						data: z
							.array(
								z.object({
									score: z.number(),
									content: z.array(z.object({ text: z.string(), type: z.string() })),
									file_id: z.string().optional(),
									filename: z.string().optional(),
									attributes: object.optional(),
								}),
							)
							.optional()
							.default([]),
					})
					.parse(value).data as VectorResult[],
		),
	ingest: (file: File, provider: string, id: string | undefined, name: string, description: string, params: Record<string, unknown>) => {
		const body = new FormData();
		body.append("file", file);
		body.append(
			"request",
			JSON.stringify({
				ingest_options: {
					vector_store: { custom_llm_provider: provider, ...(id ? { vector_store_id: id } : {}), ...params },
					...(name || description
						? {
								litellm_vector_store_params: {
									...(name ? { vector_store_name: name } : {}),
									...(description ? { vector_store_description: description } : {}),
								},
							}
						: {}),
				},
			}),
		);
		return requestJson(
			"/rag/ingest",
			{ method: "POST", body },
			(value) =>
				z
					.object({
						id: z.string().optional(),
						status: z.string().optional(),
						vector_store_id: z.string().optional(),
						file_id: z.string().optional(),
						error: z.string().optional(),
					})
					.passthrough()
					.parse(value) as IngestResult,
		);
	},
};
