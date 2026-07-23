import express from "express";
import request from "supertest";
import type { ServiceConfig } from "../core/config";

let runtimeConfig: ServiceConfig;
jest.mock("../core/config", () => ({
	...jest.requireActual("../core/config"),
	getConfig: () => runtimeConfig,
}));

import { validateAndTransform } from "../core/config";
import { registerAnthropicMessagesEndpoints } from "./AnthropicMessagesEndpoint";
import { registerChatCompletionsRoutes } from "./ChatCompletionsEndpoint";
import * as SpendTracker from "../spend/SpendTracker";

function webSearchConfig(): ServiceConfig {
	return validateAndTransform({
		litellm_settings: {
			websearch_interception_params: {
				google_pse_api_key: "test-google-key",
				google_pse_engine_id: "test-engine",
				max_results: 2,
			},
		},
		router_settings: {
			enable_pre_call_checks: true,
			search_tools: [{ search_tool_name: "google", litellm_params: { search_provider: "google_pse" } }],
		},
	});
}

function googleResponse(): Response {
	return new Response(
		JSON.stringify({
			searchInformation: { totalResults: "1" },
			items: [{ title: "Docs", link: "https://docs.example", snippet: "Official docs" }],
		}),
		{ status: 200 },
	);
}

describe("WebSearch endpoint tool chains", () => {
	beforeEach(() => {
		runtimeConfig = webSearchConfig();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("Chat Completions 执行 model → Google PSE → tool result → model 链路", async () => {
		const completion = jest
			.fn()
			.mockResolvedValueOnce({
				id: "first",
				object: "chat.completion",
				created: 1,
				model: "upstream",
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: { name: "web_search", arguments: '{"query":"official docs"}' },
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
			})
			.mockResolvedValueOnce({
				id: "final",
				object: "chat.completion",
				created: 2,
				model: "upstream",
				choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "final answer" } }],
				usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
			});
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(googleResponse());
		const spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
			status: "committed",
			requestId: "request-1",
			spend: 0,
		});
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
			next();
		});
		const router = express.Router();
		registerChatCompletionsRoutes(router, { completion: completion } as never, {} as never);
		app.use(router);

		const response = await request(app)
			.post("/v1/chat/completions")
			.send({
				model: "chat-group",
				messages: [{ role: "user", content: "find docs" }],
				tools: [{ type: "function", function: { name: "web_search", parameters: { type: "object" } } }],
			})
			.expect(200);

		expect(response.body.choices[0].message.content).toBe("final answer");
		expect(response.body.usage).toMatchObject({
			prompt_tokens: 7,
			completion_tokens: 3,
			total_tokens: 10,
			server_tool_use: { web_search_requests: 1 },
		});
		expect(completion).toHaveBeenCalledTimes(2);
		expect(completion.mock.calls[1]?.[1]).toEqual([
			{ role: "user", content: "find docs" },
			expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
			{ role: "tool", tool_call_id: "call-1", content: expect.stringContaining("Official docs") },
		]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			prompt_tokens: 7,
			completion_tokens: 3,
			metadata: { additional_usage_values: { server_tool_use: { web_search_requests: 1 } } },
		});
		expect(JSON.stringify(spendSpy.mock.calls[0]?.[1])).not.toContain("test-google-key");
		expect(JSON.stringify(spendSpy.mock.calls[0]?.[1])).not.toContain("official docs");
	});

	it("Anthropic Messages 执行本地 tool_use 链路并保留 hosted search Provider 语义", async () => {
		const deployment = {
			model_name: "native-group",
			litellm_params: { model: "anthropic/upstream-model", api_key: "provider-key", custom_llm_provider: "anthropic" },
			model_info: { id: "dep-native" },
		};
		const provider = {
			transformRequest: jest.fn().mockReturnValue({
				url: "https://provider.example/v1/messages",
				method: "POST",
				headers: { "x-api-key": "provider-key" },
				body: {},
			}),
		};
		const litellmRouter = {
			getAvailableDeployment: jest.fn().mockReturnValue({ deployment: deployment, provider: provider }),
			getNextFallback: jest.fn().mockReturnValue(null),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
			hasModel: jest.fn().mockReturnValue(true),
			getNoAvailableDeploymentInfo: jest.fn().mockReturnValue({ cooldownSeconds: 60, cooldownList: [], preCallChecks: true }),
			maxFallbacks: 3,
		};
		let providerCalls = 0;
		let googleCalls = 0;
		const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
			const url = String(input);
			if (url.startsWith("https://www.googleapis.com/customsearch/v1")) {
				googleCalls++;
				return googleResponse();
			}
			providerCalls++;
			if (providerCalls === 1) {
				return new Response(
					JSON.stringify({
						id: "msg-tool",
						type: "message",
						role: "assistant",
						model: "upstream",
						content: [{ type: "tool_use", id: "tool-1", name: "web_search", input: { query: "official docs" } }],
						stop_reason: "tool_use",
						usage: { input_tokens: 2, output_tokens: 1 },
					}),
					{ status: 200 },
				);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body["messages"]).toEqual([
				{ role: "user", content: "find docs" },
				{ role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "web_search", input: { query: "official docs" } }] },
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tool-1", content: expect.stringContaining("Official docs") }],
				},
			]);
			return new Response(
				JSON.stringify({
					id: "msg-final",
					type: "message",
					role: "assistant",
					model: "upstream",
					content: [{ type: "text", text: "final answer" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 5, output_tokens: 2 },
				}),
				{ status: 200 },
			);
		});
		const app = express();
		app.use(express.json());
		const router = express.Router();
		registerAnthropicMessagesEndpoints(router, litellmRouter as never);
		app.use(router);

		const localResponse = await request(app)
			.post("/v1/messages")
			.send({
				model: "native-group",
				max_tokens: 100,
				messages: [{ role: "user", content: "find docs" }],
				tools: [{ name: "web_search", description: "local", input_schema: { type: "object" } }],
			})
			.expect(200);

		expect(localResponse.body.content).toEqual([{ type: "text", text: "final answer" }]);
		expect(localResponse.body.usage).toMatchObject({
			input_tokens: 7,
			output_tokens: 3,
			server_tool_use: { web_search_requests: 1 },
		});
		expect(providerCalls).toBe(2);
		expect(googleCalls).toBe(1);

		providerCalls = 0;
		googleCalls = 0;
		fetchSpy.mockImplementation(async () => {
			providerCalls++;
			return new Response(
				JSON.stringify({
					id: "msg-hosted",
					type: "message",
					role: "assistant",
					model: "upstream",
					content: [{ type: "text", text: "hosted result" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1 } },
				}),
				{ status: 200 },
			);
		});
		await request(app)
			.post("/v1/messages")
			.send({
				model: "native-group",
				max_tokens: 100,
				messages: [{ role: "user", content: "find docs" }],
				tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
			})
			.expect(200);
		expect(providerCalls).toBe(1);
		expect(googleCalls).toBe(0);
	});
});
