import { z } from "zod";
import { getApiBaseUrl, requestJson } from "../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown());
export const mcpOAuthApi = {
	cache: (body: Record<string, unknown>) =>
		requestJson("/v1/mcp/server/oauth/session", { method: "POST", body: JSON.stringify(body) }, (value) =>
			z.object({ server_id: z.string() }).passthrough().parse(value),
		),
	register: (id: string, body: Record<string, unknown>) =>
		requestJson(
			"/v1/mcp/server/oauth/" + encodeURIComponent(id.trim()) + "/register",
			{ method: "POST", headers: { Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) },
			(value) => z.object({ client_id: z.string().optional(), client_secret: z.string().optional() }).passthrough().parse(value),
		),
	exchange: (
		flow: { serverId: string; clientId?: string; clientSecret?: string; codeVerifier: string; redirectUri: string },
		code: string,
	) => {
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
			(value) => record.parse(value),
		);
	},
};
export function mcpAuthorizeUrl(flow: {
	serverId: string;
	clientId?: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
	scope?: string;
}) {
	const params = new URLSearchParams({
		redirect_uri: flow.redirectUri,
		state: flow.state,
		response_type: "code",
		code_challenge: flow.codeChallenge,
		code_challenge_method: "S256",
	});
	if (flow.clientId?.trim()) params.set("client_id", flow.clientId);
	if (flow.scope?.trim()) params.set("scope", flow.scope);
	return getApiBaseUrl() + "/v1/mcp/server/oauth/" + encodeURIComponent(flow.serverId.trim()) + "/authorize?" + params;
}
