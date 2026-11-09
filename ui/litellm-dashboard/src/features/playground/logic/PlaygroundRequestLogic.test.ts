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
	traceId: "trace-fixture",
	voice: "alloy",
	audio: null,
});
describe("Playground request contracts", () => {
	it("keeps routing and trace choices in chat requests while optional parameters stay optional", () => {
		const value = request(),
			body = requestBody(value);
		expect(body).toMatchObject({
			model: "fixture",
			stream: true,
			stream_options: { include_usage: true },
			litellm_trace_id: "trace-fixture",
		});
		expect(body).not.toHaveProperty("temperature");
		expect(requestBody({ ...value, temperature: 0.7, maxTokens: 123, mockFallbacks: true })).toMatchObject({
			temperature: 0.7,
			max_tokens: 123,
			mock_testing_fallbacks: true,
		});
	});
	it("adds the code interpreter tool and previous response id to Responses requests", () => {
		const value = request();
		value.endpoint = "responses";
		value.codeInterpreter = true;
		value.previousResponseId = "response-previous";
		const body = requestBody(value),
			tools = body.tools as Record<string, unknown>[];
		expect(tools).toEqual([{ type: "code_interpreter", container: { type: "auto" } }]);
		expect(body.previous_response_id).toBe("response-previous");
		expect(body).not.toHaveProperty("stream_options");
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
