/**
 * Built-in provider quota and balance types.
 *
 * These describe account-level data for providers called directly by this proxy
 * (DeepSeek, MiniMax), as opposed to CLIProxy OAuth account subscriptions.
 */

/**
 * A single quota window shown on a quota card.
 */
export interface ProviderQuotaWindow {
	/** Stable window id, for example general-5h. */
	readonly id: string;
	/** Display label, for example MiniMax · 5-hour. */
	readonly label: string;
	/** Used percentage, or null when unknown. */
	readonly used_percent: number | null;
	/** Remaining percentage, or null when unknown. */
	readonly remaining_percent: number | null;
	/** Reset time in ISO format, or null when unknown. */
	readonly resets_at: string | null;
}

/**
 * A balance row for a prepaid account.
 *
 * Balance has no artificial limit, so it exposes remaining instead of the
 * CLIProxy used/limit pair; a fake limit would mislead the reader.
 */
export interface ProviderQuotaBalance {
	/** Display label, for example DeepSeek balance (CNY). */
	readonly label: string;
	/** Remaining amount. */
	readonly remaining: number;
	/** Currency code, for example CNY or USD. */
	readonly unit: string;
	/** Optional breakdown rows, for example granted and topped-up balance. */
	readonly details?: readonly string[];
}

/** Provider account kind detected from the configured key. */
export type ProviderQuotaAccountKind = "subscription" | "pay_as_you_go" | "unknown";

/** One upstream account quota response. */
export interface ProviderQuotaAccount {
	/** Stable id; never contains the plaintext key. */
	readonly id: string;
	/** Provider id: deepseek or minimax. */
	readonly provider: string;
	/** Display label: credential name or masked key suffix. */
	readonly label: string;
	/** Model groups using this account. */
	readonly models: readonly string[];
	/** Detected account kind. */
	readonly account_kind: ProviderQuotaAccountKind;
	/** Subscription plan name, if the provider reports one. */
	readonly plan: string | null;
	/** Subscription expiry time in ISO format. */
	readonly subscription_expires_at: string | null;
	/** Quota windows. */
	readonly windows: readonly ProviderQuotaWindow[];
	/** Account balances. */
	readonly balances: readonly ProviderQuotaBalance[];
	/** Account-level warning that is not a query failure, for example low balance. */
	readonly warning?: string;
	/** Query time in ISO format. */
	readonly fetched_at: string;
	/** Failure reason when the quota query itself failed. */
	readonly error?: string;
}
