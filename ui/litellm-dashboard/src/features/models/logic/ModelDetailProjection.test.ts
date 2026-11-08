import { describe, expect, it } from "vitest";
import { normalizeModelDetails, transformModels } from "./ModelDataLogic";
import { mergeModelUpdate, createModelEditDraft } from "./ModelEditLogic";
import type { ProxyModel } from "../support/ModelModels";
const raw: ProxyModel = {
	model_name: "research",
	litellm_params: { model: "openai/gpt-4.1", custom_llm_provider: "openai" },
	model_info: { id: "model-1", input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
};
describe("raw model details", () => {
	it("keeps the legacy overview empty while the settings retain configured token prices", () => {
		const detail = normalizeModelDetails(raw);
		expect(detail).toMatchObject({ provider: "", litellm_model_name: "openai/gpt-4.1", input_cost: null, output_cost: null });
		expect(createModelEditDraft(detail)).toMatchObject({ input_cost: 2, output_cost: 8 });
		expect(transformModels([raw], {})[0]).toMatchObject({ provider: "openai", input_cost: 2, output_cost: 8 });
	});
	it("retains provided overview values after a patch instead of replacing them from nested settings", () => {
		const current = normalizeModelDetails({ ...raw, provider: "provider-display", input_cost: 7, output_cost: 9 });
		const request = { model_name: "renamed", litellm_params: raw.litellm_params, model_info: { input_cost_per_token: 0.000003 } };
		const result = normalizeModelDetails(mergeModelUpdate(current, { ...raw, ...request }, request));
		expect(result).toMatchObject({ model_name: "renamed", provider: "provider-display", input_cost: 7, output_cost: 9 });
		expect(createModelEditDraft(result).input_cost).toBe(3);
	});
});
