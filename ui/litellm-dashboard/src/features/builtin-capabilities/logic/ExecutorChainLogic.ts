import type { Capabilities, CapabilityExecutor, CapabilityId, DeepSeekExecutor } from "../support/BuiltinCapabilitiesModels";
export function createDeepSeekExecutor(credentialName = ""): DeepSeekExecutor {
	return {
		type: "deepseek_tools",
		api_base: "https://api.deepseek.com",
		credential_name: credentialName,
		timeout_ms: 15000,
		search_count: 10,
		search_need_content: false,
		localization: "",
	};
}
export function convertExecutor(type: "model" | "deepseek_tools", current?: CapabilityExecutor): CapabilityExecutor {
	if (type === "deepseek_tools") return createDeepSeekExecutor(current?.type === "deepseek_tools" ? current.credential_name : "");
	return {
		type: "model",
		model: current?.type === "model" ? current.model : "",
		...(current?.type === "model" && current.max_output_tokens !== undefined ? { max_output_tokens: current.max_output_tokens } : {}),
	};
}
export function moveExecutor(values: readonly CapabilityExecutor[], index: number, direction: -1 | 1): CapabilityExecutor[] {
	const next = [...values],
		target = index + direction;
	if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}
export function validateCapabilities(capabilities: Capabilities): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const id of ["image_generation", "vision", "web"] as CapabilityId[]) {
		const value = capabilities[id];
		if (id !== "vision" && value.enabled && !value.executors?.length) errors[id + ".executors"] = "Add at least one executor";
		if (value.max_iterations === null || value.max_iterations === undefined)
			errors[id + ".max_iterations"] = "'Maximum private turns' is required";
		if (id !== "image_generation" && (value.max_output_tokens === null || value.max_output_tokens === undefined))
			errors[id + ".max_output_tokens"] = "'Worker output token limit' is required";
	}
	return errors;
}
