import { describe, expect, it } from "vitest";
import { convertExecutor, createDeepSeekExecutor, moveExecutor, validateCapabilities } from "./ExecutorChainLogic";
import type { Capabilities, CapabilityExecutor } from "../support/BuiltinCapabilitiesModels";
describe("built-in executor configuration", () => {
	it("keeps ordered fallbacks and leaves the original chain unchanged", () => {
		const first: CapabilityExecutor = { type: "model", model: "primary" },
			second = createDeepSeekExecutor("stored-credential"),
			chain = [first, second];
		expect(moveExecutor(chain, 1, -1)).toEqual([second, first]);
		expect(chain).toEqual([first, second]);
		expect(moveExecutor(chain, 0, -1)).toEqual(chain);
	});
	it("does not carry credentials or provider settings into a model executor", () => {
		expect(convertExecutor("model", createDeepSeekExecutor("credential-name"))).toEqual({ type: "model", model: "" });
		expect(convertExecutor("deepseek_tools", { type: "model", model: "router-model", max_output_tokens: 65536 })).toEqual(
			createDeepSeekExecutor(),
		);
		expect(convertExecutor("model", { type: "model", model: "router-model", max_output_tokens: 65536 })).toEqual({
			type: "model",
			model: "router-model",
			max_output_tokens: 65536,
		});
	});
	it("requires an execution chain when image or web is enabled and preserves optional image token limits", () => {
		const settings = {
				enabled: false,
				always_inject: false,
				handler_model: "",
				executors: [],
				max_iterations: 20,
				max_output_tokens: 32768,
			},
			config: Capabilities = {
				vision: { ...settings, enabled: true },
				image_generation: { ...settings, enabled: true, max_output_tokens: null },
				web: { ...settings, enabled: true },
			};
		expect(validateCapabilities(config)).toEqual({
			"image_generation.executors": "Add at least one executor",
			"web.executors": "Add at least one executor",
		});
		config.image_generation.executors = [{ type: "model", model: "image-worker" }];
		config.web.executors = [createDeepSeekExecutor("tools")];
		expect(validateCapabilities(config)).toEqual({});
	});
});
