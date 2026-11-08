import { describe, expect, it } from "vitest";
import { requestBody } from "./PlaygroundRequestLogic";
import type { PlaygroundRequest } from "../support/PlaygroundModels";
const request = (): PlaygroundRequest => ({
	endpoint: "chat",
	auth: { kind: "session" },
	model: "fixture",
	messages: [{ role: "user", content: "Hello" }],
	input: "Hello",
	tags: [],
	guardrails: ["guardrail-fixture"],
	policies: ["policy_fixture"],
	vectorStores: ["vector-fixture"],
	mcpServers: [],
	selectedMcpServers: [],
	mcpRestrictions: {},
	traceId: "trace-fixture",
	voice: "alloy",
	images: [],
	audio: null,
	agent: "",
});
describe("Playground request contracts", () => {
	it("keeps routing, safety and trace choices in chat requests while optional parameters stay optional", () => {
		const value = request(),
			body = requestBody(value);
		expect(body).toMatchObject({
			model: "fixture",
			stream: true,
			stream_options: { include_usage: true },
			guardrails: ["guardrail-fixture"],
			policies: ["policy_fixture"],
			vector_store_ids: ["vector-fixture"],
			litellm_trace_id: "trace-fixture",
		});
		expect(body).not.toHaveProperty("temperature");
		expect(requestBody({ ...value, temperature: 0.7, maxTokens: 123, mockFallbacks: true })).toMatchObject({
			temperature: 0.7,
			max_tokens: 123,
			mock_testing_fallbacks: true,
		});
	});
	it("routes Responses MCP tools by distinct registered names even when aliases collide", () => {
		const value = request();
		value.endpoint = "responses";
		value.customBaseUrl = "https://proxy.example.test";
		value.mcpServers = [
			{ server_id: "one", server_name: "server one", alias: "same" },
			{ server_id: "two", server_name: "server-two", alias: "same" },
		];
		value.selectedMcpServers = ["one", "two"];
		value.mcpRestrictions = { one: ["read"] };
		value.codeInterpreter = true;
		value.previousResponseId = "response-previous";
		const body = requestBody(value),
			tools = body.tools as Record<string, unknown>[];
		expect(tools[0]).toMatchObject({
			server_label: "server one",
			server_url: "https://proxy.example.test/mcp/server%20one",
			allowed_tools: ["read"],
		});
		expect(tools[1].server_label).toBe("server-two");
		expect(tools[2]).toEqual({ type: "code_interpreter", container: { type: "auto" } });
		expect(body.previous_response_id).toBe("response-previous");
	});
	it("sends native Anthropic messages with its existing token budget", () => {
		const value = request();
		value.endpoint = "anthropic_messages";
		const body = requestBody(value);
		expect(body.messages).toEqual(value.messages);
		expect(body.max_tokens).toBe(1024);
		expect(body).not.toHaveProperty("stream_options");
	});
});
