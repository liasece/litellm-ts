import { isBuiltinCapabilityAvailable, normalizeBuiltinCapabilitiesConfig } from "./BuiltinCapabilitiesConfig";
import type { Deployment } from "../types/router";

describe("BuiltinCapabilitiesConfig", () => {
	it("defaults worker output limits to 32K and preserves values above the former 16K ceiling", () => {
		const defaults = normalizeBuiltinCapabilitiesConfig({});
		expect(defaults.vision.max_output_tokens).toBe(32_768);
		expect(defaults.image_generation.max_output_tokens).toBe(32_768);
		expect(defaults.image_generation.always_inject).toBe(true);
		expect(defaults.web.max_output_tokens).toBe(32_768);

		const configured = normalizeBuiltinCapabilitiesConfig({
			vision: { max_output_tokens: 65_536 },
			web: { max_output_tokens: 131_072 },
		});
		expect(configured.vision.max_output_tokens).toBe(65_536);
		expect(configured.web.max_output_tokens).toBe(131_072);
	});

	it("advertises a selected capability only when its global executor is usable", () => {
		const deployment: Deployment = {
			model_name: "text-model",
			litellm_params: { model: "deepseek/text-model" },
			model_info: {
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			},
		};
		const configured = normalizeBuiltinCapabilitiesConfig({
			vision: { enabled: true, handler_model: "vision-worker" },
		});

		expect(isBuiltinCapabilityAvailable(deployment, "vision", configured)).toBe(true);
		expect(
			isBuiltinCapabilityAvailable(
				deployment,
				"vision",
				normalizeBuiltinCapabilitiesConfig({ vision: { enabled: true, handler_model: "" } }),
			),
		).toBe(false);

		deployment.model_info!.supports_function_calling = false;
		expect(isBuiltinCapabilityAvailable(deployment, "vision", configured)).toBe(false);
	});
});
