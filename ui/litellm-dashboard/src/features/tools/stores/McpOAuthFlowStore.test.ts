import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createMcpOAuthFlowStore } from "./McpOAuthFlowStore";
import { mcpOAuthApi } from "../api/McpOAuthApi";
vi.mock("../../notifications/logic/NotificationManager", () => ({ notificationManager: { error: vi.fn(), success: vi.fn() } }));
function storage() {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => map.set(key, value),
		removeItem: (key: string) => map.delete(key),
	};
}
const FLOW = "litellm-mcp-oauth-flow-state",
	RESULT = "litellm-mcp-oauth-result",
	RETURN = "litellm-mcp-oauth-return-url";
describe("MCP OAuth browser round trip", () => {
	let session: ReturnType<typeof storage>, local: ReturnType<typeof storage>;
	beforeEach(() => {
		session = storage();
		local = storage();
		vi.stubGlobal("window", {
			sessionStorage: session,
			localStorage: local,
			location: {
				pathname: "/prefix/ui/",
				origin: "https://example.test",
				href: "https://example.test/prefix/ui/?page=mcp-servers",
				assign: vi.fn(),
			},
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	function seed(state = "expected") {
		session.setItem(
			FLOW,
			JSON.stringify({
				state,
				codeVerifier: "verifier",
				serverId: "temporary-server",
				redirectUri: "https://example.test/ui/mcp/oauth/callback",
				clientId: "synthetic-client",
			}),
		);
		session.setItem(RESULT, JSON.stringify({ state: "expected", code: "synthetic-code" }));
		session.setItem(RETURN, "https://example.test/ui/");
	}
	it("rejects a callback state mismatch before token exchange and clears both storage generations", async () => {
		seed("wrong");
		local.setItem(FLOW, "legacy-state");
		const exchange = vi.spyOn(mcpOAuthApi, "exchange"),
			received = vi.fn();
		const store = createMcpOAuthFlowStore(
			() => null,
			received,
			() => {},
		);
		await store.resume();
		expect(exchange).not.toHaveBeenCalled();
		expect(received).not.toHaveBeenCalled();
		expect(store.state.error).toBe("OAuth state mismatch. Please retry.");
		for (const key of [FLOW, RESULT, RETURN]) {
			expect(session.getItem(key)).toBeNull();
			expect(local.getItem(key)).toBeNull();
		}
	});
	it("consumes a valid callback exactly once and delivers fresh credentials to the form", async () => {
		seed();
		const exchange = vi.spyOn(mcpOAuthApi, "exchange").mockResolvedValue({ access_token: "synthetic-provider-token", expires_in: 600 }),
			received = vi.fn();
		const store = createMcpOAuthFlowStore(
			() => null,
			received,
			() => {},
		);
		await Promise.all([store.resume(), store.resume()]);
		expect(exchange).toHaveBeenCalledTimes(1);
		expect(exchange).toHaveBeenCalledWith(
			expect.objectContaining({ codeVerifier: "verifier", serverId: "temporary-server" }),
			"synthetic-code",
		);
		expect(received).toHaveBeenCalledWith({ access_token: "synthetic-provider-token", expires_in: 600 });
		expect(store.state.status).toBe("success");
		expect(session.getItem(FLOW)).toBeNull();
	});
	it("recovers legacy storage results but reports provider denial without exchanging a token", async () => {
		local.setItem(FLOW, JSON.stringify({ state: "expected", codeVerifier: "verifier", serverId: "temporary-server" }));
		local.setItem(RESULT, JSON.stringify({ state: "expected", error: "access_denied", error_description: "Synthetic denial" }));
		const exchange = vi.spyOn(mcpOAuthApi, "exchange"),
			store = createMcpOAuthFlowStore(
				() => null,
				() => {},
				() => {},
			);
		await store.resume();
		expect(exchange).not.toHaveBeenCalled();
		expect(store.state.error).toBe("Synthetic denial");
		expect(local.getItem(FLOW)).toBeNull();
	});
	it("persists browser-only PKCE state before redirect and uses DCR for incomplete client credentials", async () => {
		vi.spyOn(mcpOAuthApi, "cache").mockResolvedValue({ server_id: "temporary-server" });
		const register = vi.spyOn(mcpOAuthApi, "register").mockResolvedValue({ client_id: "registered-client" }),
			persist = vi.fn();
		const store = createMcpOAuthFlowStore(
			() => ({ url: "https://example.test/mcp", transport: "http", alias: "Example", credentials: { scopes: ["read", "write"] } }),
			() => {},
			persist,
		);
		await store.start();
		expect(register).toHaveBeenCalledWith(
			"temporary-server",
			expect.objectContaining({ client_name: "Example", token_endpoint_auth_method: "none" }),
		);
		expect(persist).toHaveBeenCalledOnce();
		const saved = JSON.parse(session.getItem(FLOW)!);
		expect(saved.codeVerifier.length).toBeGreaterThanOrEqual(43);
		expect(saved.redirectUri).toBe("https://example.test/prefix/ui/mcp/oauth/callback");
		expect(local.getItem(FLOW)).toBeNull();
		const target = vi.mocked(window.location.assign).mock.calls[0]?.[0];
		const url = new URL(String(target), "https://example.test");
		expect(url.searchParams.get("state")).toBe(saved.state);
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	});
});
