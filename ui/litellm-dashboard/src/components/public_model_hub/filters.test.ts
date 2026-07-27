import { describe, expect, it } from "vitest";
import {
	filterPublicAgents,
	filterPublicMcpServers,
	filterPublicModels,
	getUniqueAgentSkills,
	getUniqueFeatures,
	getUniqueMcpTransports,
	getUniqueModes,
	getUniqueProviders,
} from "./filters";
import type {
	PublicAgentCard,
	PublicMcpServer,
	PublicModelInfo,
} from "./types";

const model = (
	name: string,
	overrides: Partial<PublicModelInfo> = {},
): PublicModelInfo => ({
	model_group: name,
	providers: ["openai"],
	mode: "chat",
	supports_parallel_function_calling: false,
	supports_vision: false,
	supports_function_calling: false,
	...overrides,
});

const agent = (
	name: string,
	description: string,
	tags: string[],
): PublicAgentCard => ({
	protocolVersion: "1",
	name,
	description,
	url: "https://example.com",
	version: "1",
	defaultInputModes: ["text"],
	defaultOutputModes: ["text"],
	skills: [{ id: name, name: "Skill", description: "", tags }],
});

const server = (
	name: string,
	transport: string,
	description = "",
): PublicMcpServer => ({
	server_id: name,
	name,
	server_name: name,
	url: "https://example.com",
	transport,
	auth_type: "none",
	mcp_info: { server_name: name, description },
});

describe("public model hub filters", () => {
	it("ranks exact and prefix model matches before looser matches", () => {
		const models = [
			model("vendor/gpt-4"),
			model("gpt-4-turbo"),
			model("gpt-4"),
		];

		expect(filterPublicModels(models, "gpt-4", [], [], []).map((item) => item.model_group)).toEqual([
			"gpt-4",
			"gpt-4-turbo",
			"vendor/gpt-4",
		]);
	});

	it("combines provider, mode, and feature filters", () => {
		const models = [
			model("vision", { providers: ["azure"], supports_vision: true }),
			model("embedding", { mode: "embedding" }),
		];

		expect(
			filterPublicModels(models, "", ["azure"], ["chat"], ["Vision"]),
		).toEqual([models[0]]);
	});

	it("filters agents by description and skill tag", () => {
		const agents = [
			agent("Finance helper", "Converts currencies", ["finance"]),
			agent("Writer", "Drafts reports", ["writing"]),
		];

		expect(filterPublicAgents(agents, "currencies", ["finance"])).toEqual([agents[0]]);
	});

	it("filters MCP servers by description and transport", () => {
		const servers = [
			server("github", "sse", "Repository tools"),
			server("files", "stdio", "Local files"),
		];

		expect(filterPublicMcpServers(servers, "repository", ["sse"])).toEqual([servers[0]]);
	});

	it("derives unique filter options", () => {
		const models = [
			model("a", { providers: ["openai", "azure"], supports_vision: true }),
			model("b", { providers: ["openai"], mode: "embedding" }),
		];
		const agents = [agent("a", "", ["finance", "shared"]), agent("b", "", ["shared"])];
		const servers = [server("a", "sse"), server("b", "sse"), server("c", "stdio")];

		expect(getUniqueProviders(models)).toEqual(["openai", "azure"]);
		expect(getUniqueModes(models)).toEqual(["chat", "embedding"]);
		expect(getUniqueFeatures(models)).toEqual(["Vision"]);
		expect(getUniqueAgentSkills(agents)).toEqual(["finance", "shared"]);
		expect(getUniqueMcpTransports(servers)).toEqual(["sse", "stdio"]);
	});
});

