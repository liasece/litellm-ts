import { buildModelGroupOverrides } from "./ModelOverrides";

describe("buildModelGroupOverrides", () => {
	it("rejects redirect cycles before they reach request routing", () => {
		expect(() =>
			buildModelGroupOverrides([
				{
					model_name: "model-a",
					litellm_params: { model: "openai/a" },
					model_info: { override_model_name: "model-b" },
				},
				{
					model_name: "model-b",
					litellm_params: { model: "openai/b" },
					model_info: { override_model_name: "model-a" },
				},
			]),
		).toThrow("Model override cycle detected: model-a -> model-b -> model-a");
	});

	it("rejects an unknown reasoning effort override before updating router state", () => {
		expect(() =>
			buildModelGroupOverrides([
				{
					model_name: "model-a",
					litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
					model_info: { override_reasoning_effort: "ultra" as never },
				},
			]),
		).toThrow("override_reasoning_effort must be one of");
	});

	it("rejects Codex-only minimal effort for Anthropic deployments", () => {
		expect(() =>
			buildModelGroupOverrides([
				{
					model_name: "claude",
					litellm_params: { model: "anthropic/claude-sonnet-5", custom_llm_provider: "anthropic" },
					model_info: { override_reasoning_effort: "minimal" },
				},
			]),
		).toThrow("Anthropic reasoning effort override does not support minimal");
	});
});
