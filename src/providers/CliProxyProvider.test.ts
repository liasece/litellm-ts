import { CliProxyProvider } from "./CliProxyProvider";

describe("CliProxyProvider", () => {
	const provider = new CliProxyProvider("internal-secret", "http://127.0.0.1:8317");

	it("forwards the complete OpenAI request without leaking LiteLLM connection parameters", () => {
		const request = provider.transformRequest("cliproxy/gpt-5.4", [{ role: "user", content: "hello" }], {
			stream: true,
			reasoning: { effort: "xhigh" },
			custom_future_field: { enabled: true },
			api_base: "http://127.0.0.1:8317",
			api_key: "must-not-appear-in-body",
			custom_llm_provider: "cliproxy",
		});

		expect(request.url).toBe("http://127.0.0.1:8317/v1/chat/completions");
		expect(request.headers.Authorization).toBe("Bearer internal-secret");
		expect(request.body).toMatchObject({
			model: "gpt-5.4",
			messages: [{ role: "user", content: "hello" }],
			reasoning: { effort: "xhigh" },
			custom_future_field: { enabled: true },
		});
		expect(request.body).not.toHaveProperty("api_key");
		expect(request.body).not.toHaveProperty("api_base");
		expect(request.body).not.toHaveProperty("custom_llm_provider");
	});

	it("builds an Anthropic-native upstream attempt for the Messages endpoint", () => {
		const request = provider.transformRequest("claude-sonnet-4-5", [], {
			anthropic_version: "2023-06-01",
		});

		expect(request.url).toBe("http://127.0.0.1:8317/v1/messages");
		expect(request.headers["x-api-key"]).toBe("internal-secret");
		expect(request.headers["anthropic-version"]).toBe("2023-06-01");
	});

	it("builds a standard image-generation upstream request without connection fields", () => {
		const request = provider.transformImageRequest("cliproxy/gpt-image-2", "draw a cat", {
			response_format: "b64_json",
			output_format: "png",
			api_key: "must-not-appear-in-body",
			api_base: "http://wrong.example",
			custom_llm_provider: "cliproxy",
		});

		expect(request.url).toBe("http://127.0.0.1:8317/v1/images/generations");
		expect(request.headers.Authorization).toBe("Bearer internal-secret");
		expect(request.body).toEqual({
			model: "gpt-image-2",
			prompt: "draw a cat",
			response_format: "b64_json",
			output_format: "png",
		});
	});

	it("returns the CLIProxy response object without normalizing away native fields", () => {
		const response = {
			id: "chatcmpl-native",
			object: "chat.completion",
			created: 1,
			model: "gpt-5.4",
			choices: [],
			usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
			new_provider_field: { preserved: true },
		};

		expect(provider.transformResponse("gpt-5.4", response)).toBe(response);
	});
});
