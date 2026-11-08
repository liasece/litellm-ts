import type { Capabilities, CapabilitySettings } from "../support/BuiltinCapabilitiesModels";
function editableSettings(value: CapabilitySettings): CapabilitySettings {
	return {
		enabled: value.enabled,
		executors: value.executors,
		max_iterations: value.max_iterations,
		max_output_tokens: value.max_output_tokens,
	};
}
export function builtinCapabilitiesFormValues(capabilities: Capabilities): Capabilities {
	// Match the fields registered by the form. Response-only defaults must not become edits.
	const values: Capabilities = {
		image_generation: {
			...editableSettings(capabilities.image_generation),
			always_inject: capabilities.image_generation.always_inject,
		},
		vision: { ...editableSettings(capabilities.vision), always_inject: capabilities.vision.always_inject },
		web: editableSettings(capabilities.web),
	};
	return JSON.parse(JSON.stringify(values)) as Capabilities;
}
