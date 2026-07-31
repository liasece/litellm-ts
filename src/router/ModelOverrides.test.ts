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
});
