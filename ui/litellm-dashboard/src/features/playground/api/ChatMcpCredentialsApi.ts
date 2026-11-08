import { z } from "zod";
import { requestJson, getApiBaseUrl } from "../../platform/api/HttpApiClient";
const credential = z
		.object({
			server_id: z.string(),
			server_name: z.string().nullish(),
			alias: z.string().nullish(),
			connected_at: z.string().nullish(),
			expires_at: z.string().nullish(),
		})
		.passthrough(),
	status = z.object({ server_id: z.string(), has_credential: z.boolean(), is_expired: z.boolean() }).passthrough();
export type ChatMcpCredential = z.infer<typeof credential>;
export interface McpOAuthState {
	state: string;
	codeVerifier: string;
	serverId: string;
	redirectUri: string;
	clientId?: string;
	clientSecret?: string;
	scopes?: string[];
}
export const mcpOAuthStateSchema = z.object({
	state: z.string(),
	codeVerifier: z.string(),
	serverId: z.string(),
	redirectUri: z.string(),
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
	scopes: z.array(z.string()).optional(),
});
const endpoint = (serverId: string) => "/v1/mcp/server/" + encodeURIComponent(serverId) + "/oauth-user-credential";
export const chatMcpCredentialsApi = {
	list(signal?: AbortSignal) {
		return requestJson("/v1/mcp/user-credentials", { signal }, (value) => z.array(credential).parse(value));
	},
	async status(serverId: string, signal?: AbortSignal) {
		try {
			return await requestJson(endpoint(serverId) + "/status", { signal }, (value) => status.parse(value));
		} catch {
			return { server_id: serverId, has_credential: false, is_expired: false };
		}
	},
	remove(serverId: string) {
		return requestJson<unknown>(endpoint(serverId), { method: "DELETE" });
	},
	store(serverId: string, token: { access_token: string; refresh_token?: string; expires_in?: number; scopes?: string[] }) {
		return requestJson<unknown>(endpoint(serverId), { method: "POST", body: JSON.stringify(token) });
	},
	register(serverId: string, name: string) {
		return requestJson(
			"/v1/mcp/server/oauth/" + encodeURIComponent(serverId.trim()) + "/register",
			{
				method: "POST",
				headers: { Accept: "application/json, text/event-stream" },
				body: JSON.stringify({
					client_name: name,
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
				}),
			},
			(value) => z.object({ client_id: z.string().optional(), client_secret: z.string().optional() }).passthrough().parse(value),
		);
	},
	exchange(flow: McpOAuthState, code: string) {
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			code_verifier: flow.codeVerifier,
			redirect_uri: flow.redirectUri,
		});
		if (flow.clientId?.trim()) body.set("client_id", flow.clientId);
		if (flow.clientSecret?.trim()) body.set("client_secret", flow.clientSecret);
		return requestJson(
			"/v1/mcp/server/oauth/" + encodeURIComponent(flow.serverId.trim()) + "/token",
			{ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
			(value) =>
				z
					.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional() })
					.passthrough()
					.parse(value),
		);
	},
};
export function mcpAuthorizeUrl(flow: McpOAuthState, challenge: string) {
	const params = new URLSearchParams({
		redirect_uri: flow.redirectUri,
		state: flow.state,
		response_type: "code",
		code_challenge: challenge,
		code_challenge_method: "S256",
	});
	if (flow.clientId?.trim()) params.set("client_id", flow.clientId);
	const scope = flow.scopes?.filter((value) => value.trim()).join(" ");
	if (scope) params.set("scope", scope);
	return getApiBaseUrl() + "/v1/mcp/server/oauth/" + encodeURIComponent(flow.serverId.trim()) + "/authorize?" + params.toString();
}
