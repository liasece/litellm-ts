import { describe, expect, it } from "vitest";
import { filterHubAgents, filterHubMcp, filterHubModels } from "./ModelHubFilterLogic";
import { hubAgentSchema, hubMcpSchema, hubModelSchema } from "../api/ModelHubSchemas";
describe("Hub catalog filtering", () => {
	it("keeps smart multi-word model matching and combines provider/mode with any selected capability", () => {
		const models = [
			hubModelSchema.parse({ model_group: "gpt 4 fast", providers: ["openai"], mode: "chat", supports_vision: true }),
			hubModelSchema.parse({ model_group: "gpt 4", providers: ["openai"], mode: "chat", supports_function_calling: true }),
			hubModelSchema.parse({ model_group: "gpt 4 embed", providers: ["azure"], mode: "embedding", supports_vision: true }),
		];
		expect(
			filterHubModels(models, "gpt 4", ["openai"], ["chat"], ["Vision", "Function Calling"], true).map((model) => model.model_group),
		).toEqual(["gpt 4", "gpt 4 fast"]);
		expect(filterHubModels(models, "fast gpt", [], [], [], true).map((model) => model.model_group)).toEqual(["gpt 4 fast"]);
		expect(filterHubModels(models, "fast gpt", [], [], [], false)).toEqual([]);
	});
	it("searches agent words across name and description and intersects skill filters", () => {
		const agents = [
			hubAgentSchema.parse({
				name: "Research",
				description: "Find and summarize reports",
				skills: [{ id: "one", name: "Web", description: "", tags: ["research"] }],
			}),
			hubAgentSchema.parse({ name: "Research", description: "Write code", skills: [] }),
		];
		expect(filterHubAgents(agents, "research reports", ["research"])).toEqual([agents[0]]);
	});
	it("uses public MCP descriptions and transport filters without exposing private fields", () => {
		const servers = [
			hubMcpSchema.parse({
				server_id: "one",
				server_name: "Docs",
				transport: "http",
				mcp_info: { description: "Search company knowledge" },
			}),
			hubMcpSchema.parse({
				server_id: "two",
				server_name: "Docs local",
				transport: "stdio",
				mcp_info: { description: "Search company knowledge" },
			}),
		];
		expect(filterHubMcp(servers, "docs knowledge", ["http"])).toEqual([servers[0]]);
	});
});
