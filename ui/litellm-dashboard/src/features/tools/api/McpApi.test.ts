import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mcpApi, semanticTest } from "./McpServersApi";
import { mcpOAuthApi, mcpAuthorizeUrl } from "./McpOAuthApi";
describe("MCP wire contracts", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockImplementation(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=synthetic-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());
	function last() {
		const [url, init] = fetch.mock.calls.at(-1)!;
		return {
			url: String(url),
			init: init!,
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		};
	}
	it("approves without a JSON body and rejects with nullable review notes using session CSRF", async () => {
		await mcpApi.approve("server/a");
		expect(last()).toMatchObject({
			url: "/v1/mcp/server/server%2Fa/approve",
			init: { method: "PUT", credentials: "include" },
			body: undefined,
		});
		expect(last().headers.get("x-litellm-csrf-token")).toBe("synthetic-csrf");
		expect(last().headers.has("Authorization")).toBe(false);
		await mcpApi.reject("server/a");
		expect(last()).toMatchObject({ url: "/v1/mcp/server/server%2Fa/reject", body: { review_notes: null } });
	});
	it("keeps server list and discovery/openapi envelopes distinct", async () => {
		fetch.mockResolvedValueOnce(new Response('[{"server_id":"example","server_name":"Synthetic"}]'));
		await expect(mcpApi.list()).resolves.toMatchObject([{ server_id: "example", server_name: "Synthetic" }]);
		fetch.mockResolvedValueOnce(new Response('{"servers":[],"categories":["Development"]}'));
		await expect(mcpApi.discover()).resolves.toEqual({ servers: [], categories: ["Development"] });
		fetch.mockResolvedValueOnce(new Response('{"apis":[{"name":"example","spec_url":"https://example.test/spec"}]}'));
		await expect(mcpApi.openapi()).resolves.toMatchObject([{ name: "example" }]);
		fetch.mockResolvedValueOnce(new Response("[]"));
		await mcpApi.health(["a/b", "second"]);
		expect(last().url).toBe("/v1/mcp/server/health?server_ids=a%2Fb&server_ids=second");
	});
	it("tests connection errors as a structured response and keeps OAuth provider tokens separate from session credentials", async () => {
		fetch.mockResolvedValueOnce(
			new Response('{"error":"invalid_server","message":"Synthetic failure","stack_trace":"Synthetic stack"}', {
				status: 400,
				headers: { "content-type": "application/json" },
			}),
		);
		await expect(mcpApi.testTools({ transport: "http" })).resolves.toMatchObject({
			tools: [],
			error: "invalid_server",
			message: "Synthetic failure",
			stack_trace: "Synthetic stack",
		});
		expect(last().headers.get("x-litellm-api-key")).toBe("cookie-session");
		expect(last().headers.get("x-litellm-csrf-token")).toBe("synthetic-csrf");
		fetch.mockResolvedValueOnce(new Response('{"tools":[]}', { headers: { "content-type": "application/json" } }));
		await mcpApi.testTools({}, "synthetic-upstream-oauth-token");
		expect(last().headers.get("Authorization")).toBe("Bearer synthetic-upstream-oauth-token");
		expect(last().init.credentials).toBeUndefined();
	});
	it("encodes OAuth token exchange as a form body and preserves PKCE authorize parameters", async () => {
		await mcpOAuthApi.exchange(
			{
				serverId: " server/a ",
				clientId: "synthetic-client",
				clientSecret: "synthetic-secret",
				codeVerifier: "verifier",
				redirectUri: "https://example.test/ui/mcp/oauth/callback",
			},
			"code",
		);
		const [url, init] = fetch.mock.calls.at(-1)!;
		expect(String(url)).toBe("/v1/mcp/server/oauth/server%2Fa/token");
		expect(new Headers(init?.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
		expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
			grant_type: "authorization_code",
			code: "code",
			code_verifier: "verifier",
			redirect_uri: "https://example.test/ui/mcp/oauth/callback",
			client_id: "synthetic-client",
			client_secret: "synthetic-secret",
		});
		const authorize = new URL(
			mcpAuthorizeUrl({
				serverId: "server/a",
				redirectUri: "https://example.test/callback",
				state: "nonce",
				codeChallenge: "challenge",
				scope: "read write",
			}),
			"https://example.test",
		);
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorize.searchParams.get("state")).toBe("nonce");
		expect(authorize.searchParams.get("scope")).toBe("read write");
	});
	it("sends tool arguments unchanged and reads semantic filter response headers", async () => {
		fetch.mockResolvedValueOnce(new Response('{"content":[{"type":"text","text":"example"}],"isError":false}'));
		await expect(
			mcpApi.callTool("server-a", "example", { params: { count: 0 } }, { "x-mcp-example-authorization": "synthetic-value" }),
		).resolves.toEqual([{ type: "text", text: "example" }]);
		expect(last()).toMatchObject({
			url: "/mcp-rest/tools/call",
			body: { server_id: "server-a", name: "example", arguments: { params: { count: 0 } } },
		});
		fetch.mockResolvedValueOnce(
			new Response("{}", { headers: { "x-litellm-semantic-filter": "10->3", "x-litellm-semantic-filter-tools": "one,two,three" } }),
		);
		await expect(semanticTest("synthetic-model", "test query")).resolves.toEqual({ filter: "10->3", tools: "one,two,three" });
		expect(last()).toMatchObject({
			url: "/v1/responses",
			body: { model: "synthetic-model", input: [{ role: "user", content: "test query", type: "message" }], tool_choice: "required" },
		});
	});
});
