import { describe, expect, it, vi } from "vitest";
import { completeMcpOAuthCallback } from "./McpOAuthCallbackStore";

describe("MCP OAuth callback", () => {
	it("delivers provider failures to both flow namespaces and returns to the saved page", () => {
		const values = new Map([["litellm-mcp-oauth-return-url", "/ui/?page=mcp-servers"]]);
		const replace = vi.fn();
		completeMcpOAuthCallback(
			{
				pathname: "/proxy/ui/mcp/oauth/callback",
				search: "?state=fixture-state&error=access_denied&error_description=Declined",
				replace,
			},
			{
				getItem: (key) => values.get(key) ?? null,
				setItem: (key, value) => {
					values.set(key, value);
				},
			},
		);
		const admin = values.get("litellm-mcp-oauth-result")!;
		expect(JSON.parse(admin)).toEqual({
			type: "litellm-mcp-oauth",
			code: null,
			state: "fixture-state",
			error: "access_denied",
			error_description: "Declined",
		});
		expect(values.get("litellm-user-mcp-oauth-result")).toBe(admin);
		expect(replace).toHaveBeenCalledWith("/ui/?page=mcp-servers");
	});

	it("retains a deployment prefix when storage is unavailable", () => {
		const replace = vi.fn();
		completeMcpOAuthCallback(
			{ pathname: "/proxy/ui/mcp/oauth/callback", search: "?code=fixture", replace },
			{
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		);
		expect(replace).toHaveBeenCalledWith("/proxy/ui");
	});
});
