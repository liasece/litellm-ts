import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatMcpOAuthStore } from "./ChatMcpOAuthStore";
import { chatMcpCredentialsApi } from "../api/ChatMcpCredentialsApi";
import type { PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
import { pkceChallenge, mcpCallbackUrl } from "../logic/ChatMcpLogic";
function memory() {
	const values = new Map<string, string>(),
		storage: PlaygroundStorage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => {
				values.set(key, value);
			},
			removeItem: (key) => {
				values.delete(key);
			},
		};
	return { values, storage };
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
describe("user MCP OAuth resume", () => {
	it("uses the standard S256 challenge and preserves deployment root callback paths", async () => {
		expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
		expect(mcpCallbackUrl({ origin: "https://example.test", pathname: "/api/v1/ui/chat" })).toBe(
			"https://example.test/api/v1/ui/mcp/oauth/callback",
		);
	});
	it("does not consume another server's callback and refuses a state mismatch before exchanging tokens", async () => {
		vi.stubGlobal("window", { dispatchEvent: vi.fn() });
		const { storage, values } = memory();
		values.set(
			"litellm-user-mcp-oauth-flow-state",
			JSON.stringify({
				state: "expected",
				codeVerifier: "verifier",
				serverId: "one",
				redirectUri: "https://example.test/ui/mcp/oauth/callback",
			}),
		);
		values.set("litellm-user-mcp-oauth-result", JSON.stringify({ state: "different", code: "synthetic" }));
		const exchange = vi.spyOn(chatMcpCredentialsApi, "exchange"),
			connected = vi.fn(),
			store = createChatMcpOAuthStore({ storage, connected });
		await store.resume(["two"]);
		expect(values.has("litellm-user-mcp-oauth-result")).toBe(true);
		await store.resume(["one"]);
		expect(exchange).not.toHaveBeenCalled();
		expect(store.state.error).toBe("OAuth state mismatch. Please retry.");
		expect(connected).not.toHaveBeenCalled();
		expect(values.has("litellm-user-mcp-oauth-flow-state")).toBe(false);
		store.dispose();
	});
	it("stores successful tokens through the cookie API then clears transient OAuth state", async () => {
		vi.stubGlobal("window", { dispatchEvent: vi.fn() });
		const { storage, values } = memory();
		values.set(
			"litellm-user-mcp-oauth-flow-state",
			JSON.stringify({
				state: "match",
				codeVerifier: "verifier",
				serverId: "one",
				redirectUri: "https://example.test/ui/mcp/oauth/callback",
				scopes: ["read"],
			}),
		);
		values.set("litellm-user-mcp-oauth-result", JSON.stringify({ state: "match", code: "synthetic" }));
		vi.spyOn(chatMcpCredentialsApi, "exchange").mockResolvedValue({ access_token: "synthetic", expires_in: 60 });
		const persist = vi.spyOn(chatMcpCredentialsApi, "store").mockResolvedValue({}),
			connected = vi.fn(),
			store = createChatMcpOAuthStore({ storage, connected });
		await store.resume(["one"]);
		expect(persist).toHaveBeenCalledWith("one", {
			access_token: "synthetic",
			refresh_token: undefined,
			expires_in: 60,
			scopes: ["read"],
		});
		expect(connected).toHaveBeenCalledWith("one");
		expect(values.has("litellm-user-mcp-oauth-result")).toBe(false);
		expect(values.has("litellm-user-mcp-oauth-flow-state")).toBe(false);
		store.dispose();
	});
});
