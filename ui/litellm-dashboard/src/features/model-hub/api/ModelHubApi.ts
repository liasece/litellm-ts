import { z } from "zod";
import { dashboardFetch, getApiBaseUrl, requestJson } from "../../platform/api/HttpApiClient";
import type { HubAgent, HubInfo, HubMarketplace, HubMcp, HubModel, HubPublishKind, UsefulLinks } from "../support/ModelHubModels";
import { hubAgentSchema, hubInfoSchema, hubMarketplaceSchema, hubMcpSchema, hubModelSchema } from "./ModelHubSchemas";
async function publicList<T>(path: string, parse: (value: unknown) => T[], signal?: AbortSignal): Promise<T[]> {
	// Public catalog reads never depend on an authenticated user or an explicit API key.
	// Cookie handling is the existing dashboardFetch contract shared by the original public page.
	const response = await dashboardFetch(getApiBaseUrl() + path, { signal, headers: { "Content-Type": "application/json" } });
	if (!response.ok) return [];
	const payload: unknown = await response.json();
	return Array.isArray(payload) ? parse(payload) : [];
}
const listModels = (value: unknown): HubModel[] => z.array(hubModelSchema).parse(value);
const listAgents = (value: unknown): HubAgent[] => z.array(hubAgentSchema).parse(value);
const listMcp = (value: unknown): HubMcp[] => z.array(hubMcpSchema).parse(value);
export const modelHubApi = {
	models: (signal?: AbortSignal) =>
		requestJson("/model_group/info", { signal }, (value) => z.object({ data: z.array(hubModelSchema) }).parse(value).data),
	agents: (signal?: AbortSignal) =>
		requestJson("/v1/agents", { signal }, (value) =>
			z
				.array(
					z
						.object({
							agent_id: z.string().optional(),
							agent_card_params: z.record(z.string(), z.unknown()).optional(),
							is_public: z.boolean().optional(),
							litellm_params: z.object({ is_public: z.boolean().optional() }).optional(),
						})
						.passthrough(),
				)
				.parse(value)
				.map((agent) =>
					hubAgentSchema.parse({
						agent_id: agent.agent_id,
						...agent.agent_card_params,
						is_public: agent.is_public ?? agent.litellm_params?.is_public,
					}),
				),
		),
	mcp: (signal?: AbortSignal) => requestJson("/v1/mcp/server", { signal }, listMcp),
	publicModels: (signal?: AbortSignal) => publicList("/public/model_hub", listModels, signal),
	publicAgents: (signal?: AbortSignal) => publicList("/public/agent_hub", listAgents, signal),
	publicMcp: (signal?: AbortSignal) => publicList("/public/mcp_hub", listMcp, signal),
	info: (signal?: AbortSignal): Promise<HubInfo> =>
		requestJson("/public/model_hub/info", { signal }, (value) => hubInfoSchema.parse(value)),
	settings: (signal?: AbortSignal) =>
		requestJson(
			"/get/ui_settings",
			{ signal },
			(value) => z.object({ values: z.object({ require_auth_for_public_ai_hub: z.boolean().optional() }) }).parse(value).values,
		),
	publicEnabled: (signal?: AbortSignal) =>
		requestJson(
			"/config/field/info?field_name=enable_public_model_hub",
			{ signal },
			(value) => z.object({ field_value: z.unknown() }).parse(value).field_value === true,
		),
	session: (signal?: AbortSignal) =>
		requestJson("/auth/session", { signal }, (value) => z.object({ authenticated: z.boolean() }).parse(value).authenticated),
	marketplace: (signal?: AbortSignal): Promise<HubMarketplace> =>
		requestJson("/claude-code/marketplace.json", { signal }, (value) => hubMarketplaceSchema.parse(value)),
	saveLinks: (links: UsefulLinks, signal?: AbortSignal) =>
		requestJson("/model_hub/update_useful_links", { method: "POST", body: JSON.stringify({ useful_links: links }), signal }),
	publish: (kind: HubPublishKind, ids: string[], signal?: AbortSignal) => {
		const endpoint =
			kind === "models" ? "/model_group/make_public" : kind === "agents" ? "/v1/agents/make_public" : "/v1/mcp/make_public";
		const field = kind === "models" ? "model_groups" : kind === "agents" ? "agent_ids" : "mcp_server_ids";
		return requestJson(endpoint, { method: "POST", body: JSON.stringify({ [field]: ids }), signal });
	},
};
