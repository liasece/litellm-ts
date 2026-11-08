import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { Agent, AgentTypeInfo, AgentKey } from "../support/AgentModels";
const record = z.record(z.string(), z.unknown()),
	agent = z
		.object({
			agent_id: z.string(),
			agent_name: z.string(),
			litellm_params: record.nullish().transform((value) => value ?? {}),
			agent_card_params: record.optional(),
		})
		.passthrough();
const url = (id: string) => "/v1/agents/" + encodeURIComponent(id);
export const agentsApi = {
	list: (health: boolean, signal?: AbortSignal) =>
		requestJson("/v1/agents" + (health ? "?health_check=true" : ""), { signal }, (value) => z.array(agent).parse(value) as Agent[]),
	detail: (id: string, signal: AbortSignal) => requestJson(url(id), { signal }, (value) => agent.parse(value) as Agent),
	metadata: () =>
		requestJson(
			"/public/agents/fields",
			undefined,
			(value) =>
				z
					.array(
						z
							.object({
								agent_type: z.string(),
								agent_type_display_name: z.string(),
								credential_fields: z.array(z.object({ key: z.string(), label: z.string() }).passthrough()),
							})
							.passthrough(),
					)
					.parse(value) as AgentTypeInfo[],
		),
	create: (body: Record<string, unknown>) =>
		requestJson("/v1/agents", { method: "POST", body: JSON.stringify(body) }, (value) => agent.parse(value) as Agent),
	update: (id: string, body: Record<string, unknown>) => requestJson(url(id), { method: "PATCH", body: JSON.stringify(body) }),
	delete: (id: string) => requestJson(url(id), { method: "DELETE" }),
	keys: (size: number) =>
		requestJson(
			"/key/list?" +
				new URLSearchParams({
					page: "1",
					size: String(size),
					return_full_object: "true",
					include_team_keys: "true",
					include_created_by_keys: "true",
				}),
			undefined,
			(value) =>
				z
					.object({
						keys: z
							.array(
								z
									.object({
										token: z.string(),
										key_alias: z.string().nullable().optional(),
										agent_id: z
											.string()
											.nullish()
											.transform((value) => value ?? undefined),
									})
									.passthrough(),
							)
							.optional()
							.default([]),
					})
					.parse(value).keys as AgentKey[],
		),
	models: () =>
		requestJson("/models?include_model_access_groups=True", undefined, (value) => {
			const rows = Array.isArray(value) ? value : z.object({ data: z.array(record) }).parse(value).data;
			return rows
				.map((row) => z.object({ id: z.string().optional(), model_name: z.string().optional() }).parse(row))
				.map((row) => row.id ?? row.model_name)
				.filter((id): id is string => Boolean(id));
		}),
	mcpServers: () =>
		requestJson("/v1/mcp/server", undefined, (value) =>
			z.array(z.object({ server_id: z.string(), server_name: z.string().nullish() }).passthrough()).parse(value),
		),
	mcpGroups: () =>
		requestJson(
			"/v1/mcp/access_groups",
			undefined,
			(value) => z.object({ access_groups: z.array(z.string()).optional().default([]) }).parse(value).access_groups,
		),
	guardrails: () =>
		requestJson("/guardrails/list", undefined, (value) =>
			z
				.object({ guardrails: z.array(record).optional().default([]) })
				.parse(value)
				.guardrails.map((row) => String(row.guardrail_name || ""))
				.filter(Boolean),
		),
};
