import { OpenAICompatProvider } from "./OpenAICompatProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { normalizeAnthropicThinking } from "./AnthropicThinkingCompatibility";

describe("current upstream protocol compatibility", () => {
	it("requires explicit deployment opt-in for native endpoints and keeps connection details out of the body", () => {
		const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
		expect(provider.transformResponsesRequest("openai/custom", { input: "hi" }, {})).toBeUndefined();
		const request = provider.transformResponsesRequest(
			"openai/custom",
			{
				input: "hi",
				api_key: "body-secret",
				auth_token: "client-token",
				extra_headers: { Authorization: "client-secret" },
				litellm_credential_name: "client-credential",
				drop_params: true,
				reasoning: { effort: "high" },
			},
			{ supported_endpoints: ["/v1/responses"] },
		);
		expect(request?.url).toBe("https://example.invalid/v1/responses");
		expect(request?.body).toEqual({ model: "custom", input: "hi", reasoning: { effort: "high" }, store: false });
		expect(provider.transformAnthropicRequest("openai/custom", { supported_endpoints: ["/v1/messages"] })?.url).toBe(
			"https://example.invalid/v1/messages",
		);
	});
	it.each(["claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5"])(
		"uses advertised adaptive thinking for %s",
		(model) => {
			const request = new AnthropicProvider("test-key").transformRequest(model, [{ role: "user", content: "hi" }], {
				reasoning_effort: "high",
			});
			expect((request.body as Record<string, unknown>)["thinking"]).toEqual({ type: "adaptive" });
		},
	);
	it("translates adaptive thinking for an older model without discarding output format", () => {
		const result = normalizeAnthropicThinking(
			{ thinking: { type: "adaptive" }, output_config: { effort: "high", format: { type: "json_schema" } }, max_tokens: 2000 },
			"claude-sonnet-4-5",
		);
		expect(result["thinking"]).toEqual({ type: "enabled", budget_tokens: 1999 });
		expect(result["output_config"]).toEqual({ format: { type: "json_schema" } });
	});
});

it("drops unsupported sampling only when requested, including Codex compatibility", () => {
	const provider = new AnthropicProvider("test-key");
	const body = provider.transformRequest("claude-opus-5", [{ role: "user", content: "hi" }], {
		temperature: 0.4,
		top_p: 0.8,
		drop_params: true,
	}).body as Record<string, unknown>;
	expect(body["temperature"]).toBeUndefined();
	expect(body["top_p"]).toBeUndefined();
	expect(body["drop_params"]).toBeUndefined();
});

it("consumes routing tags without forwarding them as invalid OpenAI metadata", () => {
	const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
	const metadata = { tags: ["&eu", "!slow"], tenant: "keep" };
	expect(
		(provider.transformRequest("openai/a", [{ role: "user", content: "hi" }], { metadata }).body as Record<string, unknown>)[
			"metadata"
		],
	).toEqual({ tenant: "keep" });
	expect(
		(
			provider.transformResponsesRequest("openai/a", { input: "hi", metadata }, { supported_endpoints: ["/v1/responses"] })
				?.body as Record<string, unknown>
		)["metadata"],
	).toEqual({ tenant: "keep" });
	expect(
		(provider.transformRequest("openai/a", [], { metadata: { tags: ["eu"] } }).body as Record<string, unknown>)["metadata"],
	).toBeUndefined();
	expect(metadata.tags).toEqual(["&eu", "!slow"]);
});
