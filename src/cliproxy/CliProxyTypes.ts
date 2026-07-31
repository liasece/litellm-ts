export const CLIPROXY_PROVIDER = "cliproxy";
export const CLIPROXY_CONFIG_PARAM = "cliproxy_settings";
export const CLIPROXY_DEFAULT_PORT = 8317;

/**
 *
 */
export type CliProxyProcessState = "unavailable" | "stopped" | "starting" | "running" | "degraded" | "stopping" | "updating" | "crash_loop";

/**
 *
 */
export interface CliProxyStoredSettings {
	/**
	 *
	 */
	readonly enabled: boolean;
	/**
	 * User-owned CLIProxy YAML fragment. LiteLLM adds the listener, auth directory,
	 * internal API key and management isolation fields when projecting the file.
	 */
	readonly config_yaml: string;
}

/**
 *
 */
export interface CliProxyRuntimeStatus {
	/**
	 *
	 */
	readonly available: boolean;
	/**
	 *
	 */
	readonly enabled: boolean;
	/**
	 *
	 */
	readonly state: CliProxyProcessState;
	/**
	 *
	 */
	readonly version: string | null;
	/**
	 *
	 */
	readonly installed_versions: string[];
	/**
	 *
	 */
	readonly pid: number | null;
	/**
	 *
	 */
	readonly started_at: string | null;
	/**
	 *
	 */
	readonly uptime_seconds: number | null;
	/**
	 *
	 */
	readonly restart_count: number;
	/**
	 *
	 */
	readonly last_exit_code: number | null;
	/**
	 *
	 */
	readonly last_error: string | null;
	/**
	 *
	 */
	readonly config_hash: string | null;
	/**
	 *
	 */
	readonly health: "healthy" | "unhealthy" | "unknown";
	/**
	 *
	 */
	readonly operation: string | null;
}

/**
 *
 */
export interface CliProxyLogEntry {
	/**
	 *
	 */
	readonly id: number;
	/**
	 *
	 */
	readonly timestamp: string;
	/**
	 *
	 */
	readonly stream: "stdout" | "stderr" | "system" | "oauth";
	/**
	 *
	 */
	readonly message: string;
}

/**
 *
 */
export interface CliProxyAccountSummary {
	/**
	 *
	 */
	readonly auth_index: string;
	/**
	 *
	 */
	readonly filename: string;
	/**
	 *
	 */
	readonly provider: string;
	/**
	 *
	 */
	readonly email: string | null;
	/**
	 *
	 */
	readonly disabled: boolean;
	/**
	 *
	 */
	readonly weight: number | null;
	/**
	 *
	 */
	readonly modified_at: string;
}

/**
 *
 */
export interface CliProxyQuotaWindow {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly label: string;
	/**
	 *
	 */
	readonly used_percent: number | null;
	/**
	 *
	 */
	readonly remaining_percent: number | null;
	/**
	 *
	 */
	readonly resets_at: string | null;
}

/**
 *
 */
export interface CliProxyQuotaBalance {
	/**
	 *
	 */
	readonly label: string;
	/**
	 *
	 */
	readonly used: number;
	/**
	 *
	 */
	readonly limit: number;
	/**
	 *
	 */
	readonly unit: string;
}

/** Safe, provider-neutral quota data returned to the LiteLLM dashboard. */
export interface CliProxyAccountQuota {
	/**
	 *
	 */
	readonly provider: string;
	/**
	 *
	 */
	readonly plan: string | null;
	/**
	 *
	 */
	readonly subscription_expires_at: string | null;
	/**
	 *
	 */
	readonly windows: CliProxyQuotaWindow[];
	/**
	 *
	 */
	readonly balances: CliProxyQuotaBalance[];
	/**
	 *
	 */
	readonly fetched_at: string;
}

/**
 *
 */
export type CliProxyOAuthProvider = "codex-device" | "codex" | "claude" | "antigravity" | "kimi" | "xai";

/**
 *
 */
export interface CliProxyOAuthSession {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly provider: CliProxyOAuthProvider;
	/**
	 *
	 */
	readonly state: "running" | "succeeded" | "failed" | "cancelled";
	/**
	 *
	 */
	readonly started_at: string;
	/**
	 *
	 */
	readonly finished_at: string | null;
	/**
	 *
	 */
	readonly exit_code: number | null;
	/**
	 *
	 */
	readonly output: string[];
}
