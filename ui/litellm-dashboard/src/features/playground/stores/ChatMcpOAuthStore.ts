import { shallowReactive } from "vue";
import { z } from "zod";
import { chatMcpCredentialsApi, mcpAuthorizeUrl, mcpOAuthStateSchema, type McpOAuthState } from "../api/ChatMcpCredentialsApi";
import { base64Url, mcpCallbackUrl, pkceChallenge } from "../logic/ChatMcpLogic";
import { browserSessionStorage, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
import { notify } from "../logic/PlaygroundValueLogic";
const flowKey = "litellm-user-mcp-oauth-flow-state",
	resultKey = "litellm-user-mcp-oauth-result",
	returnKey = "litellm-mcp-oauth-return-url";
export function createChatMcpOAuthStore(options: {
	connected: (id: string) => void;
	storage?: PlaygroundStorage;
	redirect?: (url: string) => void;
}) {
	const state = shallowReactive({
			status: {} as Record<string, "authorizing" | "exchanging" | "success" | "error">,
			error: null as string | null,
		}),
		storage = options.storage ?? browserSessionStorage();
	let processing = false,
		disposed = false;
	function read(key: string) {
		try {
			return storage?.getItem(key);
		} catch {
			return null;
		}
	}
	function put(key: string, value: string) {
		try {
			storage?.setItem(key, value);
		} catch {
			/* OAuth callback will report inaccessible session state. */
		}
	}
	function remove(key: string) {
		try {
			storage?.removeItem(key);
		} catch {
			/* Session storage can be unavailable. */
		}
	}
	function status(id: string, value: "authorizing" | "exchanging" | "success" | "error") {
		if (!disposed) state.status = { ...state.status, [id]: value };
	}
	async function start(serverId: string, name: string, clientId?: string, scopes?: string[]) {
		status(serverId, "authorizing");
		state.error = null;
		try {
			let secret: string | undefined;
			if (!clientId) {
				try {
					const registration = await chatMcpCredentialsApi.register(serverId, name);
					clientId = registration.client_id;
					secret = registration.client_secret;
				} catch {
					/* Dynamic client registration is optional. */
				}
			}
			const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32))),
				challenge = await pkceChallenge(verifier),
				flow: McpOAuthState = {
					state: crypto.randomUUID(),
					codeVerifier: verifier,
					serverId,
					redirectUri: mcpCallbackUrl(window.location),
					clientId,
					clientSecret: secret,
					scopes,
				};
			if (disposed) return;
			put(flowKey, JSON.stringify(flow));
			const returnUrl = new URL(window.location.href);
			returnUrl.searchParams.set("mcpOauthReturn", "apps");
			put(returnKey, returnUrl.toString());
			(options.redirect ?? ((url) => window.location.assign(url)))(mcpAuthorizeUrl(flow, challenge));
		} catch (error) {
			state.error = error instanceof Error ? error.message : String(error);
			status(serverId, "error");
			notify("error", state.error);
		}
	}
	async function resume(serverIds: string[]) {
		if (processing || disposed) return;
		const result = read(resultKey);
		if (!result) return;
		const raw = read(flowKey);
		let flow: McpOAuthState;
		try {
			flow = mcpOAuthStateSchema.parse(JSON.parse(raw || "null"));
			if (!serverIds.includes(flow.serverId)) return;
		} catch {
			remove(resultKey);
			remove(flowKey);
			state.error = "Failed to resume OAuth flow. Please retry.";
			notify("error", state.error);
			return;
		}
		processing = true;
		remove(resultKey);
		try {
			const payload = z
				.object({
					state: z.string().nullish(),
					code: z.string().nullish(),
					error: z.string().nullish(),
					error_description: z.string().nullish(),
				})
				.parse(JSON.parse(result));
			if (!flow.state || !flow.codeVerifier || !flow.serverId) throw new Error("OAuth session state was lost. Please retry.");
			if (!payload.state || payload.state !== flow.state) throw new Error("OAuth state mismatch. Please retry.");
			if (payload.error) throw new Error(payload.error_description || payload.error);
			if (!payload.code) throw new Error("Authorization code missing in callback.");
			status(flow.serverId, "exchanging");
			const token = await chatMcpCredentialsApi.exchange(flow, payload.code);
			await chatMcpCredentialsApi.store(flow.serverId, {
				access_token: token.access_token,
				refresh_token: token.refresh_token,
				expires_in: token.expires_in,
				scopes: flow.scopes,
			});
			if (!disposed) {
				status(flow.serverId, "success");
				state.error = null;
				notify("success", "Connected successfully");
				options.connected(flow.serverId);
			}
		} catch (error) {
			if (!disposed) {
				state.error = error instanceof Error ? error.message : String(error);
				status(flow.serverId, "error");
				notify("error", state.error);
			}
		} finally {
			remove(flowKey);
			processing = false;
		}
	}
	return {
		state,
		start,
		resume,
		dispose: () => {
			disposed = true;
		},
	};
}
export type ChatMcpOAuthStore = ReturnType<typeof createChatMcpOAuthStore>;
