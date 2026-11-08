import { describe, it, expect } from "vitest";
import { mcpPayload, mcpFormErrors, mcpEditDraft, mcpDiscoveryDraft, canTestMcp } from "./McpDraftLogic";
import {
	mcpDefaultValue,
	mcpToolSchema,
	mcpInitialArguments,
	mcpToolArguments,
	mcpArgumentErrors,
	mcpForwardedHeaders,
} from "./McpToolSchemaLogic";
import { filterMcpServers } from "./McpListLogic";
import type { MCPServer, McpFormConfig, InputSchema } from "../support/McpModels";
const config = (): McpFormConfig => ({ cost: {}, allowedTools: [], displayNames: {}, descriptions: {} });
const server: MCPServer = {
	server_id: "server-synthetic",
	server_name: "existing",
	created_at: "2026-01-01",
	created_by: "synthetic",
	updated_at: "2026-01-01",
	updated_by: "synthetic",
	allow_all_keys: true,
	available_on_public_internet: true,
};
describe("MCP compatibility behavior", () => {
	it("maps OpenAPI to HTTP, retains explicit zero pricing, and omits empty credentials", () => {
		const options = config();
		options.cost = { default_cost_per_query: 0 };
		const result = mcpPayload(
			{
				server_name: "example",
				transport: "openapi",
				spec_path: "https://example.test/spec.json",
				auth_type: "none",
				credentials: { auth_value: "unused" },
				available_on_public_internet: true,
			},
			options,
		);
		expect(result).toMatchObject({
			transport: "http",
			spec_path: "https://example.test/spec.json",
			available_on_public_internet: true,
			allowed_tools: null,
			tool_name_to_display_name: null,
			mcp_info: { mcp_server_cost_info: { default_cost_per_query: 0 } },
		});
		expect(result).not.toHaveProperty("credentials");
	});
	it("extracts the first nested stdio server and retains the legacy create name normalization", () => {
		const result = mcpPayload(
			{
				transport: "stdio",
				stdio_config: JSON.stringify({
					mcpServers: {
						"synthetic-tool": { command: "npx", args: ["-y", "package"], env: { EXAMPLE: "value" } },
						ignored: { command: "other" },
					},
				}),
			},
			config(),
		);
		expect(result).toMatchObject({ server_name: "synthetic_tool", command: "npx", args: ["-y", "package"], env: { EXAMPLE: "value" } });
		expect(JSON.stringify(result)).not.toContain("stdio_config");
	});
	it("edits stdio with JSON precedence, normalized env and explicit permission resets", () => {
		const result = mcpPayload(
			{
				transport: "stdio",
				command: "ignored",
				args: ["ignored"],
				stdio_config: JSON.stringify({ command: "npx", args: ["", "-y", 2], env: { COUNT: 0, EMPTY: null } }),
				credentials: { client_id: "", scopes: [] },
			},
			config(),
			server,
		);
		expect(result).toMatchObject({
			server_id: server.server_id,
			command: "npx",
			args: ["-y", "2"],
			env: { COUNT: "0", EMPTY: "" },
			extra_headers: [],
			disallowed_tools: [],
			mcp_access_groups: [],
			allow_all_keys: true,
			available_on_public_internet: true,
		});
		expect(result).not.toHaveProperty("credentials");
	});
	it("preserves duplicate static header precedence and filters empty OAuth scopes", () => {
		const result = mcpPayload(
			{
				transport: "http",
				auth_type: "oauth2",
				credentials: { client_id: "synthetic-client", scopes: ["read", "", null], access_token: "", expires_in: 0 },
				static_headers: [
					{ header: " X-Example ", value: "first" },
					{ header: "X-Example", value: "last" },
				],
			},
			config(),
		);
		expect(result).toMatchObject({
			static_headers: { "X-Example": "last" },
			credentials: { client_id: "synthetic-client", scopes: ["read"], expires_in: 0 },
		});
		expect(result.credentials).not.toHaveProperty("access_token");
	});
	it("keeps distinct create and edit required credentials and accepts Kubernetes service URLs", () => {
		const fields = { transport: "http", url: "http://service-name.namespace:1234/mcp", auth_type: "aws_sigv4", credentials: {} };
		expect(mcpFormErrors(fields)).toHaveProperty("aws_region_name");
		expect(mcpFormErrors(fields, true)).toEqual({});
		expect(mcpFormErrors({ ...fields, server_name: "bad name" })).toHaveProperty("server_name");
		expect(canTestMcp({ transport: "http", url: "https://example.test", auth_type: "oauth2", oauth_flow_type: "interactive" })).toBe(
			false,
		);
		expect(canTestMcp({ transport: "openapi", spec_path: "https://example.test/spec" })).toBe(true);
	});
	it("round trips existing OpenAPI and discovery stdio configuration without inventing auth", () => {
		expect(
			mcpEditDraft({
				...server,
				transport: "http",
				spec_path: "https://example.test/spec",
				static_headers: { "X-Example": "value" },
			}),
		).toMatchObject({ transport: "openapi", static_headers: [{ header: "X-Example", value: "value" }] });
		const draft = mcpDiscoveryDraft({
			name: "vendor/synthetic-tool",
			title: "Synthetic",
			description: "Example",
			category: "Development",
			transport: "stdio",
			command: "npx",
			env_vars: [{ name: "EXAMPLE", description: "Example value" }],
		});
		expect(draft.server_name).toBe("vendor_synthetic_tool");
		expect(JSON.parse(String(draft.stdio_config))).toMatchObject({ command: "npx", env: { EXAMPLE: "<Example value>" } });
		expect(draft).not.toHaveProperty("auth_type");
	});
	it("builds recursive defaults including tuple arrays and nested object overrides", () => {
		expect(
			mcpDefaultValue({
				type: "object",
				default: { name: "preset" },
				properties: {
					name: { type: "string" },
					enabled: { type: "boolean" },
					items: { type: "array", items: [{ type: "integer" }, { type: "string", default: "example" }] },
				},
			}),
		).toEqual({ name: "preset", enabled: false, items: [0, "example"] });
		expect(
			mcpDefaultValue({ type: "array", default: [], items: { type: "object", properties: { count: { type: "integer" } } } }),
		).toEqual([{ count: 0 }]);
	});
	it("unwraps nested params for editing then converts and wraps submitted arguments", () => {
		const schema: InputSchema = {
			type: "object",
			properties: {
				params: {
					type: "object",
					required: ["query"],
					properties: {
						query: { type: "string" },
						limit: { type: "integer" },
						enabled: { type: "boolean" },
						filters: { type: "object" },
					},
				},
			},
		};
		const tool = { inputSchema: schema },
			actual = mcpToolSchema(tool).schema;
		expect(mcpInitialArguments(actual)).toEqual({ query: "", limit: 0, enabled: false, filters: "{}" });
		expect(mcpArgumentErrors(actual, { query: "", filters: "[]" })).toMatchObject({
			query: expect.any(String),
			filters: expect.any(String),
		});
		expect(
			mcpToolArguments(tool, { query: "example", limit: "3.9", enabled: "false", filters: '{"status":"open"}', omitted: "" }),
		).toEqual({ params: { query: "example", limit: 3, enabled: false, filters: { status: "open" } } });
	});
	it("forwards nonempty custom headers under the alias and applies team/group filters before created sorting", () => {
		expect(mcpForwardedHeaders("Example", { Authorization: " original-value ", Empty: " " })).toEqual({
			"x-mcp-Example-authorization": " original-value ",
		});
		const rows = [
			{ ...server, server_id: "older", mcp_access_groups: ["dev"], teams: [{ team_id: "team-a" }] },
			{ ...server, server_id: "newer", created_at: "2026-02-01", mcp_access_groups: ["dev"], teams: [{ team_id: "team-b" }] },
		];
		expect(filterMcpServers(rows, "all", "dev").map((row) => row.server_id)).toEqual(["newer", "older"]);
		expect(filterMcpServers(rows, "team-a", "dev").map((row) => row.server_id)).toEqual(["older"]);
		expect(filterMcpServers(rows, "personal", "all")).toEqual([]);
	});
});
