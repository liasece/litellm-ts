export interface RuntimeStatus {
	available: boolean;
	enabled: boolean;
	state: string;
	version: string | null;
	installed_versions: string[];
	pid: number | null;
	started_at: string | null;
	uptime_seconds: number | null;
	restart_count: number;
	last_exit_code: number | null;
	last_error: string | null;
	config_hash: string | null;
	health: string;
	operation: string | null;
}

export interface Account {
	auth_index: string;
	filename: string;
	provider: string;
	email: string | null;
	disabled: boolean;
	weight: number | null;
	priority?: number;
	status?: string | null;
	last_error?: string | null;
	refresh_failures?: number;
	rate_limit?: {
		capturedAt: string;
		limited: boolean;
		retryAfterSeconds?: number;
		headers: Record<string, string>;
	} | null;
	modified_at: string;
}

export interface CommandCodeAccount {
	index: number;
	label: string;
	filename: string;
}

export interface QuotaWindow {
	id: string;
	label: string;
	used_percent: number | null;
	remaining_percent: number | null;
	resets_at: string | null;
}

export interface QuotaBalance {
	label: string;
	used: number;
	limit: number;
	unit: string;
}

export interface AccountQuota {
	provider: string;
	plan: string | null;
	subscription_expires_at: string | null;
	windows: QuotaWindow[];
	balances: QuotaBalance[];
	fetched_at: string;
}

export interface AccountQuotaState {
	status: "idle" | "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}

export interface OAuthSession {
	id: string;
	provider: string;
	state: string;
	started_at: string;
	finished_at: string | null;
	exit_code: number | null;
	output: string[];
}

export interface CliProxyLogEntry {
	id: number;
	timestamp: string;
	stream: "stdout" | "stderr" | "system" | "oauth";
	message: string;
}
