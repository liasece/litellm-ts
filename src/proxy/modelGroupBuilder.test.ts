import { normalizeBuiltinCapabilitiesConfig } from "../capabilities/BuiltinCapabilitiesConfig";
import type { Deployment } from "../types/router";
import { buildEnrichedModelInfo, buildModelGroupInfoResponse } from "./modelGroupBuilder";

describe("effective model capabilities", () => {
	const deployment: Deployment = {
		model_name: "text-with-vision",
		litellm_params: { model: "deepseek/text-model" },
		model_info: {
			supports_vision: false,
			supports_function_calling: true,
			enabled_builtin_capabilities: ["vision"],
		},
	};
	const capabilities = normalizeBuiltinCapabilitiesConfig({
		vision: { enabled: true, handler_model: "vision-worker" },
	});

	it("projects built-in vision into detailed model metadata", () => {
		const info = buildEnrichedModelInfo(deployment, "deployment-id", {}, capabilities);
		expect(info["supports_vision"]).toBe(true);
	});

	it("projects built-in vision into model group metadata", () => {
		const response = buildModelGroupInfoResponse([deployment], {}, capabilities);
		expect(response.data).toEqual([
			expect.objectContaining({ model_group: "text-with-vision", supports_vision: true }),
		]);
	});
});
