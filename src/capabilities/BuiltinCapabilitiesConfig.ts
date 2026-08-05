/** Database config row used by the built-in capability manager. */
export const BUILTIN_CAPABILITIES_CONFIG_PARAM = "builtin_capabilities";

/** Settings shared by capability executors and the WebUI manager. */
export interface BuiltinCapabilitySettings {
	/** Global switch. Disabled capabilities are never injected. */
	enabled: boolean;
	/** Inject the capability even when the current request has no matching payload yet. */
	always_inject: boolean;
	/** Primary LiteLLM logical model used to execute the capability. */
	handler_model: string;
	/** Capability-specific fallback chain, independent of the caller model. */
	fallback_models: string[];
	/** Maximum number of private agent turns per client request. */
	max_iterations: number;
	/** Maximum output tokens for each capability worker call. */
	max_output_tokens: number;
}

/** Currently implemented built-in capabilities. */
export interface BuiltinCapabilitiesConfig {
	/** Private image-inspection capability. */
	vision: BuiltinCapabilitySettings;
}

/** Safe defaults shown before an administrator configures the capability. */
export const DEFAULT_BUILTIN_CAPABILITIES_CONFIG: BuiltinCapabilitiesConfig = {
	vision: {
		enabled: false,
		always_inject: false,
		handler_model: "",
		fallback_models: [],
		max_iterations: 4,
		max_output_tokens: 2048,
	},
};

function integer(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, Math.trunc(value)))
		: fallback;
}

/**
 * Normalize persisted JSON without silently enabling an incomplete capability.
 * @param value
 */
export function normalizeBuiltinCapabilitiesConfig(value: Record<string, unknown>): BuiltinCapabilitiesConfig {
	const rawVision =
		typeof value["vision"] === "object" && value["vision"] !== null && !Array.isArray(value["vision"])
			? (value["vision"] as Record<string, unknown>)
			: {};
	return {
		vision: {
			enabled: rawVision["enabled"] === true,
			always_inject: rawVision["always_inject"] === true,
			handler_model: typeof rawVision["handler_model"] === "string" ? rawVision["handler_model"].trim() : "",
			fallback_models: Array.isArray(rawVision["fallback_models"])
				? [
						...new Set(
							rawVision["fallback_models"]
								.filter((model): model is string => typeof model === "string")
								.map((model) => model.trim())
								.filter(Boolean),
						),
					]
				: [],
			max_iterations: integer(rawVision["max_iterations"], 4, 1, 8),
			max_output_tokens: integer(rawVision["max_output_tokens"], 2048, 128, 16_384),
		},
	};
}
