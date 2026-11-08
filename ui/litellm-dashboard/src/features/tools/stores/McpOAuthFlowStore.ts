import { reactive } from "vue";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { mcpAuthorizeUrl, mcpOAuthApi } from "../api/McpOAuthApi";
import { objectValue } from "../logic/McpDraftLogic";
interface OAuthFlow {
	state: string;
	codeVerifier: string;
	clientId?: string;
	clientSecret?: string;
	serverId: string;
	redirectUri: string;
}
const FLOW = "litellm-mcp-oauth-flow-state",
	RESULT = "litellm-mcp-oauth-result",
	RETURN = "litellm-mcp-oauth-return-url";
function base64(value: Uint8Array) {
	return btoa(String.fromCharCode(...value))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
export function createMcpOAuthFlowStore(
	getPayload: () => Record<string, unknown> | null,
	onToken: (value: Record<string, unknown>) => void,
	beforeRedirect: () => void,
) {
	const state = reactive({
		status: "idle" as "idle" | "authorizing" | "exchanging" | "success" | "error",
		error: "",
		token: null as Record<string, unknown> | null,
	});
	let processing = false;
	function read(key: string) {
		return window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
	}
	function clear() {
		for (const key of [FLOW, RESULT, RETURN]) {
			window.sessionStorage.removeItem(key);
			window.localStorage.removeItem(key);
		}
	}
	async function start() {
		const payload = getPayload();
		if (!payload?.url || !payload.transport) {
			state.error = "Please complete server URL and transport before starting OAuth.";
			notificationManager.error(state.error);
			return;
		}
		try {
			state.status = "authorizing";
			state.error = "";
			const cached = await mcpOAuthApi.cache(payload),
				id = cached.server_id.trim();
			if (!id) throw new Error("Temporary MCP server identifier missing. Please retry.");
			const credentials = objectValue(payload.credentials);
			let client: Awaited<ReturnType<typeof mcpOAuthApi.register>> = {};
			if (!(credentials.client_id && credentials.client_secret))
				client = await mcpOAuthApi.register(id, {
					client_name: payload.alias || payload.server_name || id,
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: credentials.client_secret ? "client_secret_post" : "none",
				});
			const verifier = base64(crypto.getRandomValues(new Uint8Array(32))),
				challenge = base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
				nonce = crypto.randomUUID();
			const index = window.location.pathname.indexOf("/ui"),
				prefix = index >= 0 ? window.location.pathname.slice(0, index + 3) : "",
				redirectUri = window.location.origin + prefix.replace(/\/+$/, "") + "/mcp/oauth/callback";
			const clientId = client.client_id || (typeof credentials.client_id === "string" ? credentials.client_id : undefined),
				clientSecret =
					client.client_secret || (typeof credentials.client_secret === "string" ? credentials.client_secret : undefined);
			const flow: OAuthFlow = { state: nonce, codeVerifier: verifier, clientId, clientSecret, serverId: id, redirectUri };
			beforeRedirect();
			window.sessionStorage.setItem(FLOW, JSON.stringify(flow));
			window.sessionStorage.setItem(RETURN, window.location.href);
			window.location.assign(
				mcpAuthorizeUrl({
					serverId: id,
					clientId,
					redirectUri,
					state: nonce,
					codeChallenge: challenge,
					scope: Array.isArray(credentials.scopes)
						? credentials.scopes.filter((scope) => typeof scope === "string" && scope.trim()).join(" ")
						: undefined,
				}),
			);
		} catch (error) {
			state.status = "error";
			state.error = error instanceof Error ? error.message : String(error);
			notificationManager.error(state.error);
		}
	}
	async function resume() {
		if (processing) return;
		let result: Record<string, unknown>, flow: OAuthFlow;
		try {
			const stored = read(RESULT);
			if (!stored) return;
			processing = true;
			result = objectValue(JSON.parse(stored));
			flow = objectValue(JSON.parse(read(FLOW) || "{}")) as unknown as OAuthFlow;
			window.sessionStorage.removeItem(RESULT);
			window.localStorage.removeItem(RESULT);
		} catch {
			state.status = "error";
			state.error = "Failed to resume OAuth flow. Please retry.";
			notificationManager.error(state.error);
			clear();
			processing = false;
			return;
		}
		try {
			if (!flow.state || !flow.codeVerifier || !flow.serverId)
				throw new Error(
					"OAuth session state was lost. This can happen if you have strict browser privacy settings. Please try again and ensure cookies/storage is enabled.",
				);
			if (!result.state || result.state !== flow.state) throw new Error("OAuth state mismatch. Please retry.");
			if (result.error) throw new Error(String(result.error_description || result.error));
			if (!result.code) throw new Error("Authorization code missing in callback.");
			state.status = "exchanging";
			const token = await mcpOAuthApi.exchange(flow, String(result.code));
			onToken(token);
			state.token = token;
			state.status = "success";
			notificationManager.success("OAuth token retrieved successfully");
			state.error = "";
		} catch (error) {
			state.status = "error";
			state.error = error instanceof Error ? error.message : String(error);
			notificationManager.error(state.error);
		} finally {
			clear();
			processing = false;
		}
	}
	return { state, start, resume };
}
