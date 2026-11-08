export type UserConfig = Record<string, unknown>;
export type DisableImageGeneration = "false" | "true" | "chat" | "passthrough";

export interface VisualConfigValues {
	debug: boolean;
	commercialMode: boolean;
	requestLog: boolean;
	usageStatisticsEnabled: boolean;
	proxyUrl: string;
	requestRetry: number;
	maxRetryCredentials: number;
	maxRetryInterval: number;
	authAutoRefreshWorkers: number | null;
	disableCooling: boolean;
	saveCooldownStatus: boolean;
	transientErrorCooldownSeconds: number;
	forceModelPrefix: boolean;
	passthroughHeaders: boolean;
	wsAuth: boolean;
	routingStrategy: "round-robin" | "weighted-round-robin" | "fill-first";
	routingSessionAffinity: boolean;
	routingSessionAffinityTtl: string;
	quotaSwitchProject: boolean;
	quotaSwitchPreviewModel: boolean;
	quotaAntigravityCredits: boolean;
	disableImageGeneration: DisableImageGeneration;
	gptImage2BaseModel: string;
	logsMaxTotalSizeMb: number;
	errorLogsMaxFiles: number;
	redisUsageQueueRetentionSeconds: number;
}

export function asRecord(value: unknown): UserConfig {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UserConfig) : {};
}

function booleanValue(record: UserConfig, key: string, fallback: boolean): boolean {
	return typeof record[key] === "boolean" ? record[key] : fallback;
}

function numberValue(record: UserConfig, key: string, fallback: number): number {
	return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : fallback;
}

function optionalNumberValue(record: UserConfig, key: string): number | null {
	return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : null;
}

function stringValue(record: UserConfig, key: string, fallback: string): string {
	return typeof record[key] === "string" ? record[key] : fallback;
}

function readDisableImageGeneration(value: unknown): DisableImageGeneration {
	if (value === true) return "true";
	if (value === "chat" || value === "passthrough") return value;
	return "false";
}

export function visualValuesFromConfig(config: UserConfig): VisualConfigValues {
	const routing = asRecord(config.routing);
	const quotaExceeded = asRecord(config["quota-exceeded"]);
	return {
		debug: booleanValue(config, "debug", false),
		commercialMode: booleanValue(config, "commercial-mode", false),
		requestLog: booleanValue(config, "request-log", false),
		usageStatisticsEnabled: booleanValue(config, "usage-statistics-enabled", false),
		proxyUrl: stringValue(config, "proxy-url", ""),
		requestRetry: numberValue(config, "request-retry", 3),
		maxRetryCredentials: numberValue(config, "max-retry-credentials", 0),
		maxRetryInterval: numberValue(config, "max-retry-interval", 30),
		authAutoRefreshWorkers: optionalNumberValue(config, "auth-auto-refresh-workers"),
		disableCooling: booleanValue(config, "disable-cooling", false),
		saveCooldownStatus: booleanValue(config, "save-cooldown-status", false),
		transientErrorCooldownSeconds: numberValue(config, "transient-error-cooldown-seconds", 0),
		forceModelPrefix: booleanValue(config, "force-model-prefix", false),
		passthroughHeaders: booleanValue(config, "passthrough-headers", false),
		wsAuth: booleanValue(config, "ws-auth", true),
		routingStrategy:
			routing.strategy === "weighted-round-robin" || routing.strategy === "fill-first" ? routing.strategy : "round-robin",
		routingSessionAffinity: booleanValue(routing, "session-affinity", false),
		routingSessionAffinityTtl: stringValue(routing, "session-affinity-ttl", "1h"),
		quotaSwitchProject: booleanValue(quotaExceeded, "switch-project", true),
		quotaSwitchPreviewModel: booleanValue(quotaExceeded, "switch-preview-model", true),
		quotaAntigravityCredits: booleanValue(quotaExceeded, "antigravity-credits", true),
		disableImageGeneration: readDisableImageGeneration(config["disable-image-generation"]),
		gptImage2BaseModel: stringValue(config, "gpt-image-2-base-model", ""),
		logsMaxTotalSizeMb: numberValue(config, "logs-max-total-size-mb", 0),
		errorLogsMaxFiles: numberValue(config, "error-logs-max-files", 10),
		redisUsageQueueRetentionSeconds: numberValue(config, "redis-usage-queue-retention-seconds", 60),
	};
}

export function applyVisualValues(config: UserConfig, values: VisualConfigValues): UserConfig {
	const next = JSON.parse(JSON.stringify(config)) as UserConfig;
	next.debug = values.debug;
	next["commercial-mode"] = values.commercialMode;
	next["request-log"] = values.requestLog;
	next["usage-statistics-enabled"] = values.usageStatisticsEnabled;
	next["proxy-url"] = values.proxyUrl;
	next["request-retry"] = values.requestRetry;
	next["max-retry-credentials"] = values.maxRetryCredentials;
	next["max-retry-interval"] = values.maxRetryInterval;
	if (values.authAutoRefreshWorkers === null) {
		delete next["auth-auto-refresh-workers"];
	} else {
		next["auth-auto-refresh-workers"] = values.authAutoRefreshWorkers;
	}
	next["disable-cooling"] = values.disableCooling;
	next["save-cooldown-status"] = values.saveCooldownStatus;
	next["transient-error-cooldown-seconds"] = values.transientErrorCooldownSeconds;
	next["force-model-prefix"] = values.forceModelPrefix;
	next["passthrough-headers"] = values.passthroughHeaders;
	next["ws-auth"] = values.wsAuth;
	next.routing = {
		...asRecord(next.routing),
		strategy: values.routingStrategy,
		"session-affinity": values.routingSessionAffinity,
		"session-affinity-ttl": values.routingSessionAffinityTtl,
	};
	next["quota-exceeded"] = {
		...asRecord(next["quota-exceeded"]),
		"switch-project": values.quotaSwitchProject,
		"switch-preview-model": values.quotaSwitchPreviewModel,
		"antigravity-credits": values.quotaAntigravityCredits,
	};
	next["disable-image-generation"] =
		values.disableImageGeneration === "true" ? true : values.disableImageGeneration === "false" ? false : values.disableImageGeneration;
	if (values.gptImage2BaseModel.trim()) {
		next["gpt-image-2-base-model"] = values.gptImage2BaseModel.trim();
	} else {
		delete next["gpt-image-2-base-model"];
	}
	next["logs-max-total-size-mb"] = values.logsMaxTotalSizeMb;
	next["error-logs-max-files"] = values.errorLogsMaxFiles;
	next["redis-usage-queue-retention-seconds"] = values.redisUsageQueueRetentionSeconds;
	return next;
}
