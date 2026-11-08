import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import { inferenceRequest } from "./PlaygroundTransportApi";
import type { PlaygroundAgent, PlaygroundAuth, PlaygroundMcpServer, PlaygroundMcpTool, PlaygroundModel } from "../support/PlaygroundModels";
import { asRecord } from "../logic/PlaygroundValueLogic";
const row = z.record(z.string(), z.unknown()),
	rows = z.array(row);
const model = z.object({ model_name: z.string(), mode: z.string().optional(), type: z.enum(["model", "alias"]).optional() });
function list(value: unknown, key = "data"): Record<string, unknown>[] {
	return rows.parse(Array.isArray(value) ? value : (asRecord(value)?.[key] ?? []));
}
const server = z
	.object({ server_id: z.string(), server_name: z.string().nullish(), alias: z.string().nullable().optional() })
	.passthrough();
const tool = z.object({ name: z.string(), description: z.string().optional(), input_schema: row.optional() }).passthrough();
const agent = z
	.object({ agent_id: z.string(), agent_name: z.string(), description: z.string().optional(), agent_card_params: row.optional() })
	.passthrough();
export const playgroundCatalogApi = {
	models: (signal?: AbortSignal): Promise<PlaygroundModel[]> =>
		requestJson("/config/routable_model/options", { signal }, (value) =>
			z
				.array(model)
				.parse(Array.isArray(value) ? value : (asRecord(value)?.data ?? []))
				.map((item) => ({ model_group: item.model_name, mode: item.mode, type: item.type })),
		),
	settings: (signal?: AbortSignal) => requestJson("/sso/get/ui_settings", { signal }, (value) => row.parse(value)),
	servers: (signal?: AbortSignal): Promise<PlaygroundMcpServer[]> =>
		requestJson("/v1/mcp/server", { signal }, (value) =>
			z.array(server).parse(Array.isArray(value) ? value : (asRecord(value)?.data ?? [])),
		),
	async tools(
		serverId: string,
		headers?: Record<string, string>,
		signal?: AbortSignal,
	): Promise<{ tools: PlaygroundMcpTool[]; error?: string; message?: string }> {
		try {
			return await requestJson("/mcp-rest/tools/list?server_id=" + encodeURIComponent(serverId), { headers, signal }, (value) => {
				const record = row.parse(value);
				return {
					tools: z.array(tool).parse(record.tools ?? []),
					...(typeof record.error === "string" ? { error: record.error } : {}),
					...(typeof record.message === "string" ? { message: record.message } : {}),
				};
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			return { tools: [], error: "network_error", message: error instanceof Error ? error.message : "Failed to fetch MCP tools" };
		}
	},
	async guardrails(signal?: AbortSignal) {
		try {
			return await requestJson("/v2/guardrails/list", { signal }, (value) => list(value, "guardrails"));
		} catch (error) {
			if (signal?.aborted) throw error;
			return requestJson("/guardrails/list", { signal }, (value) => list(value, "guardrails"));
		}
	},
	policies: (signal?: AbortSignal) => requestJson("/policies/list", { signal }, (value) => list(value, "policies")),
	vectors: (signal?: AbortSignal) => requestJson("/vector_store/list", { signal }, (value) => list(value, "data")),
	tags: (signal?: AbortSignal) => requestJson("/tag/list", { signal }, (value) => row.parse(value)),
	async agents(auth: PlaygroundAuth, customBaseUrl?: string, signal?: AbortSignal): Promise<PlaygroundAgent[]> {
		const response = await inferenceRequest("/v1/agents", auth, "openai", { signal }, customBaseUrl);
		return z
			.array(agent)
			.parse(await response.json())
			.sort((a, b) => (a.agent_name || a.agent_id).localeCompare(b.agent_name || b.agent_id));
	},
	callTool: (
		serverId: string,
		name: string,
		args: Record<string, unknown>,
		options: { guardrails?: string[]; headers?: Record<string, string>; signal?: AbortSignal } = {},
	) =>
		requestJson(
			"/mcp-rest/tools/call",
			{
				method: "POST",
				headers: options.headers,
				signal: options.signal,
				body: JSON.stringify({
					server_id: serverId,
					name,
					arguments: args,
					...(options.guardrails?.length ? { litellm_metadata: { guardrails: options.guardrails } } : {}),
				}),
			},
			(value) => value,
		),
};
