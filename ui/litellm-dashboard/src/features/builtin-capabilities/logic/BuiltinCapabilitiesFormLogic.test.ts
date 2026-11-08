import { describe, expect, it } from "vitest";
import { builtinCapabilitiesFormValues } from "./BuiltinCapabilitiesFormLogic";
import type { Capabilities } from "../support/BuiltinCapabilitiesModels";
describe("built-in capability form submission", () => {
	it("leaves hidden injection defaults to the server and submits the two editable injection switches", () => {
		const defaults = {
			enabled: false,
			always_inject: false,
			handler_model: "legacy-model",
			executors: [],
			max_iterations: 4,
			max_output_tokens: 32768,
		};
		const capabilities: Capabilities = {
			vision: { ...defaults },
			image_generation: { ...defaults, always_inject: true },
			web: { ...defaults },
		};
		const submitted = builtinCapabilitiesFormValues(capabilities);
		expect(submitted.web).toEqual({ enabled: false, executors: [], max_iterations: 4, max_output_tokens: 32768 });
		expect(submitted.vision.always_inject).toBe(false);
		expect(submitted.image_generation.always_inject).toBe(true);
		for (const settings of Object.values(submitted)) expect(settings).not.toHaveProperty("handler_model");
		expect(capabilities.web.always_inject).toBe(false);
	});
	it("preserves the ordered executor payload and takes a snapshot before saving", () => {
		const capabilities: Capabilities = {
			vision: {},
			image_generation: { max_output_tokens: null },
			web: {
				executors: [
					{ type: "model", model: "first", max_output_tokens: 4096 },
					{ type: "model", model: "fallback" },
				],
			},
		};
		const submitted = builtinCapabilitiesFormValues(capabilities);
		expect(submitted.web.executors).toEqual(capabilities.web.executors);
		capabilities.web.executors!.reverse();
		expect(submitted.web.executors!.map((executor) => executor.type === "model" && executor.model)).toEqual(["first", "fallback"]);
		expect(submitted.image_generation.max_output_tokens).toBeNull();
	});
});
