import { hostedProvider } from "../subscriptions/SubscriptionProviders";

export const CLIPROXY_PROVIDER = "cliproxy";

/**
 * 判断部署是否由托管订阅运行时承载。
 *
 * 升级排空时要按这个判据把流量从 CLIProxy 上摘下来，所以判定必须与 ProviderRegistry
 * 选 provider 的规则一致：显式 custom_llm_provider 优先，其次看模型名前缀。
 * @param params - deployment 的 litellm_params
 */
export function isCliProxyDeploymentParams(params: { model?: unknown; custom_llm_provider?: unknown }): boolean {
	return hostedProvider(params) !== undefined;
}
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
	readonly engine?: "subscriptions" | "compatibility" | null;
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
	 * 是否处于升级前的降级/排空阶段（此时新请求不再进入 CLIProxy）。
	 */
	readonly draining: boolean;
	/**
	 * 当前在途的 CLIProxy 请求数，排空等待它归零。
	 */
	readonly in_flight_requests: number;
	/**
	 *
	 */
	readonly operation: string | null;
}

/** Public release metadata used by the managed update UI. */
export interface CliProxyReleaseInfo {
	/** Normalized release version without the leading `v`. */
	readonly version: string;
	/** GitHub publication time, when one was supplied. */
	readonly published_at: string | null;
	/** Public GitHub release page. */
	readonly release_url: string;
	/** Markdown release notes, reduced to the changelog when available. */
	readonly notes: string;
}

/** Current update state plus the notes for every relevant release. */
export interface CliProxyUpdateInfo {
	/** Currently active version. */
	readonly current: string | null;
	/** Newest stable release version. */
	readonly latest: string;
	/** Whether the newest stable release is newer than the active version. */
	readonly update_available: boolean;
	/** Stable releases from the oldest installed version through the latest. */
	readonly releases: CliProxyReleaseInfo[];
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
