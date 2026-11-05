import {
	MAX_BUILTIN_CAPABILITY_ITERATIONS,
	isBuiltinCapabilityAvailable,
	normalizeBuiltinCapabilitiesConfig,
} from "./BuiltinCapabilitiesConfig";
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

	it("承认 20 轮私有轮次配置，超过上限才收口", () => {
		// 4 轮时代复杂调研任务常在拿到证据前耗尽预算（生产 503「超过 4 轮仍未完成」）。
		expect(MAX_BUILTIN_CAPABILITY_ITERATIONS).toBe(20);

		const raised = normalizeBuiltinCapabilitiesConfig({ web: { max_iterations: 20 } });
		expect(raised.web.max_iterations).toBe(20);

		const oversized = normalizeBuiltinCapabilitiesConfig({ web: { max_iterations: 99 } });
		expect(oversized.web.max_iterations).toBe(MAX_BUILTIN_CAPABILITY_ITERATIONS);

		// 缺省回落到默认 4 轮，0 收到下限 1。
		expect(normalizeBuiltinCapabilitiesConfig({ web: {} }).web.max_iterations).toBe(4);
		expect(normalizeBuiltinCapabilitiesConfig({ web: { max_iterations: 0 } }).web.max_iterations).toBe(1);
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
