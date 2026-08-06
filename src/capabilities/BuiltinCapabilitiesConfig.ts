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
	/** Private web-search and webpage-fetch capability. */
	web: BuiltinCapabilitySettings;
}

/** Safe defaults shown before an administrator configures the capability. */
export const DEFAULT_BUILTIN_CAPABILITIES_CONFIG: BuiltinCapabilitiesConfig = {
	vision: {
		enabled: false,
		always_inject: false,
		handler_model: "",
		fallback_models: [],
		max_iterations: 4,
		max_output_tokens: 32_768,
	},
	web: {
		enabled: false,
		always_inject: true,
		handler_model: "",
		fallback_models: [],
		max_iterations: 4,
		max_output_tokens: 32_768,
	},
};

function integer(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function integerAtLeast(value: unknown, fallback: number, min: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.trunc(value)) : fallback;
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
	const rawWeb =
		typeof value["web"] === "object" && value["web"] !== null && !Array.isArray(value["web"])
			? (value["web"] as Record<string, unknown>)
			: {};
	const normalizeSettings = (raw: Record<string, unknown>, defaults: BuiltinCapabilitySettings): BuiltinCapabilitySettings => ({
		enabled: raw["enabled"] === true,
		always_inject: typeof raw["always_inject"] === "boolean" ? raw["always_inject"] : defaults.always_inject,
		handler_model: typeof raw["handler_model"] === "string" ? raw["handler_model"].trim() : "",
		fallback_models: Array.isArray(raw["fallback_models"])
			? [
					...new Set(
						raw["fallback_models"]
							.filter((model): model is string => typeof model === "string")
							.map((model) => model.trim())
							.filter(Boolean),
					),
				]
			: [],
		max_iterations: integer(raw["max_iterations"], defaults.max_iterations, 1, 8),
		max_output_tokens: integerAtLeast(raw["max_output_tokens"], defaults.max_output_tokens, 128),
	});
	return {
		vision: normalizeSettings(rawVision, DEFAULT_BUILTIN_CAPABILITIES_CONFIG.vision),
		web: normalizeSettings(rawWeb, DEFAULT_BUILTIN_CAPABILITIES_CONFIG.web),
	};
}
