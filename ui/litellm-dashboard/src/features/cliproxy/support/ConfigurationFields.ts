import type { VisualConfigValues } from "../logic/ConfigEditorLogic";
type BooleanKey = { [K in keyof VisualConfigValues]: VisualConfigValues[K] extends boolean ? K : never }[keyof VisualConfigValues];
type ValueKey = Exclude<keyof VisualConfigValues, BooleanKey>;
export interface ToggleDefinition {
	key: BooleanKey;
	title: string;
	description: string;
	danger?: boolean;
	full?: boolean;
}
export interface FieldDefinition {
	key: ValueKey;
	label: string;
	description: string;
	type: "text" | "number" | "select";
	placeholder?: string;
	min?: number;
	max?: number;
	quarter?: boolean;
	options?: Array<{ value: string; label: string }>;
}
export const runtimeToggles: ToggleDefinition[] = [
	{
		key: "debug",
		title: "Debug logging",
		description: "Adds detailed diagnostic messages. Keep it disabled during normal operation to reduce noise.",
	},
	{
		key: "commercialMode",
		title: "Commercial mode",
		description:
			"Disables high-overhead request logging and middleware to reduce memory use under high concurrency. A process restart may be required.",
	},
	{
		key: "usageStatisticsEnabled",
		title: "Usage statistics",
		description: "Aggregates request usage in memory for CLIProxy management and usage reporting.",
	},
	{
		key: "requestLog",
		title: "Detailed request log",
		description:
			"Records detailed request and response diagnostics. It may contain sensitive payload context and has significant I/O cost; enable only while investigating a problem.",
		danger: true,
		full: true,
	},
];
export const routingFields: FieldDefinition[] = [
	{
		key: "proxyUrl",
		label: "Global outbound proxy",
		description: 'Supports socks5, http and https URLs. Individual credentials may use "direct" or "none" to bypass it.',
		type: "text",
		placeholder: "socks5://user:pass@127.0.0.1:1080/",
	},
	{
		key: "routingStrategy",
		label: "Credential routing strategy",
		description:
			"Round robin balances requests; weighted round robin uses account weights; fill first exhausts the preferred credential before moving on.",
		type: "select",
		options: [
			{ value: "round-robin", label: "Round robin" },
			{ value: "weighted-round-robin", label: "Weighted round robin" },
			{ value: "fill-first", label: "Fill first" },
		],
	},
	{
		key: "requestRetry",
		label: "Request retries",
		description: "Retries 403, 408, 500, 502, 503 and 504 responses.",
		type: "number",
		min: 0,
		quarter: true,
	},
	{
		key: "maxRetryCredentials",
		label: "Maximum credentials",
		description: "0 keeps legacy behavior and may try every matching credential.",
		type: "number",
		min: 0,
		quarter: true,
	},
	{
		key: "maxRetryInterval",
		label: "Maximum retry wait",
		description: "Seconds to wait for a cooled credential before another attempt.",
		type: "number",
		min: 0,
		quarter: true,
	},
	{
		key: "authAutoRefreshWorkers",
		label: "Token refresh workers",
		description: "Leave empty for CLIProxy's default worker pool (currently 16).",
		type: "number",
		min: 1,
		placeholder: "Default",
		quarter: true,
	},
	{
		key: "routingSessionAffinityTtl",
		label: "Session affinity TTL",
		description: "How long a session stays bound to one credential. Automatic failover remains available.",
		type: "text",
		placeholder: "1h",
	},
	{
		key: "transientErrorCooldownSeconds",
		label: "Transient error cooldown",
		description: "Seconds for 408/500/502/503/504 failures. 0 uses the legacy 60 seconds; -1 disables this cooldown.",
		type: "number",
		min: -1,
	},
];
export const routingToggles: ToggleDefinition[] = [
	{
		key: "routingSessionAffinity",
		title: "Session affinity",
		description: "Keeps a conversation on the same credential to improve cache continuity while retaining failover.",
	},
	{
		key: "disableCooling",
		title: "Disable cooldown scheduling",
		description: "Prevents temporary blackout windows after failures. This can cause repeated traffic to an unhealthy credential.",
	},
	{
		key: "saveCooldownStatus",
		title: "Persist cooldown status",
		description: "Writes per-credential cooldown state beside auth files so it survives a process restart.",
	},
	{
		key: "forceModelPrefix",
		title: "Force model prefix",
		description: "Unprefixed model requests only use credentials without a configured prefix.",
	},
	{
		key: "passthroughHeaders",
		title: "Pass through response headers",
		description: "Forwards filtered upstream response headers to the LiteLLM client.",
	},
	{
		key: "wsAuth",
		title: "WebSocket authentication",
		description: "Requires authentication for CLIProxy WebSocket endpoints such as /v1/ws.",
	},
];
export const quotaToggles: ToggleDefinition[] = [
	{
		key: "quotaSwitchProject",
		title: "Switch project",
		description: "Try another eligible project when the selected project has exhausted its quota.",
	},
	{
		key: "quotaSwitchPreviewModel",
		title: "Switch preview model",
		description: "Fall back between preview model variants when one variant has exhausted its quota.",
	},
	{
		key: "quotaAntigravityCredits",
		title: "Use Antigravity credits",
		description: "Use paid Google One AI credits as the last fallback after free-tier credentials are exhausted.",
	},
];
export const imageFields: FieldDefinition[] = [
	{
		key: "disableImageGeneration",
		label: "Image generation behavior",
		description: "Disable everywhere, only disable chat-tool injection, or pass non-image payloads through unchanged.",
		type: "select",
		options: [
			{ value: "false", label: "Enabled everywhere" },
			{ value: "true", label: "Disabled everywhere" },
			{ value: "chat", label: "Disable chat injection only" },
			{ value: "passthrough", label: "Passthrough non-image endpoints" },
		],
	},
	{
		key: "gptImage2BaseModel",
		label: "GPT Image 2 base model",
		description: "Used by the legacy hosted image_generation path. Empty or invalid values fall back to gpt-5.4-mini.",
		type: "text",
		placeholder: "gpt-5.4-mini",
	},
];
export const retentionFields: FieldDefinition[] = [
	{
		key: "logsMaxTotalSizeMb",
		label: "Maximum log size (MB)",
		description: "0 means no total-size cleanup limit.",
		type: "number",
		min: 0,
	},
	{
		key: "errorLogsMaxFiles",
		label: "Error log files",
		description: "Maximum retained error files; 0 disables cleanup.",
		type: "number",
		min: 0,
	},
	{
		key: "redisUsageQueueRetentionSeconds",
		label: "Usage queue retention",
		description: "Seconds to retain management usage items in memory (1–3600).",
		type: "number",
		min: 1,
		max: 3600,
	},
];
