import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { KeyListResult, KeyQuery, VirtualKey } from "../support/VirtualKeyModels";

const userSchema = z
	.object({ user_id: z.string().optional(), user_alias: z.string().nullable().optional(), user_email: z.string().nullable().optional() })
	.passthrough();
export const virtualKeySchema = z
	.object({
		token: z.string(),
		token_id: z.string().nullable().optional(),
		key_name: z.string().nullable().optional(),
		key_alias: z.string().nullable().optional(),
		spend: z.number().nullable().optional(),
		max_budget: z.number().nullable().optional(),
		models: z
			.array(z.string())
			.nullish()
			.transform((value) => value ?? []),
		metadata: z
			.record(z.string(), z.unknown())
			.nullish()
			.transform((value) => value ?? {}),
		object_permission: z.record(z.string(), z.unknown()).nullable().optional(),
		user: userSchema.nullable().optional(),
		created_by_user: userSchema.nullable().optional(),
	})
	.passthrough();
const listSchema = z
	.object({
		keys: z.array(virtualKeySchema),
		total_count: z.number(),
		current_page: z.number().optional(),
		total_pages: z.number().optional(),
	})
	.passthrough();
const recordSchema = z.record(z.string(), z.unknown());

export function parseVirtualKey(payload: unknown): VirtualKey {
	return virtualKeySchema.parse(payload) as VirtualKey;
}
export function listKeys(query: KeyQuery, signal?: AbortSignal): Promise<KeyListResult> {
	const params = new URLSearchParams({
		page: String(query.page),
		size: String(query.size),
		sort_by: query.sortBy,
		sort_order: query.sortOrder,
		return_full_object: "true",
		include_team_keys: "true",
		include_created_by_keys: "true",
		expand: "user",
	});
	const filters = {
		team_id: query.filters.team,
		organization_id: query.filters.organization,
		key_alias: query.filters.alias,
		user_id: query.filters.user,
		key_hash: query.filters.hash,
	};
	for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
	return requestJson("/key/list?" + params, { signal }, (payload) => listSchema.parse(payload) as KeyListResult);
}
export function createKey(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
	return requestJson("/key/generate", { method: "POST", body: JSON.stringify(payload) }, (value) => recordSchema.parse(value));
}
export function updateKey(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
	return requestJson("/key/update", { method: "POST", body: JSON.stringify(payload) }, (value) => recordSchema.parse(value));
}
export function deleteKey(token: string): Promise<unknown> {
	return requestJson("/key/delete", { method: "POST", body: JSON.stringify({ keys: [token] }) });
}
export function regenerateKey(token: string, form: Record<string, unknown>): Promise<Record<string, unknown>> {
	return requestJson("/key/regenerate", { method: "POST", body: JSON.stringify({ ...form, token }) }, (value) =>
		recordSchema.parse(value),
	);
}
export function keyInfo(token: string): Promise<VirtualKey> {
	return requestJson("/key/info?key=" + encodeURIComponent(token), {}, (payload) => {
		const value = recordSchema.parse(payload);
		return parseVirtualKey({ ...recordSchema.parse(value.info ?? value), token, api_key: token });
	});
}
export const virtualKeysApi = { listKeys, createKey, updateKey, deleteKey, regenerateKey, keyInfo };
export type VirtualKeysApi = typeof virtualKeysApi;
