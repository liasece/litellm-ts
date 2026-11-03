/**
 * MiniMax quota query with automatic key-kind detection.
 *
 * MiniMax issues two independent credentials that must not be mixed:
 * - Subscription key: M Plan / Token Plan quota, queried with
 *   GET {host}/v1/token_plan/remains (documented).
 * - Pay-as-you-go key: account balance, queried with
 *   GET {host}/account/query_balance (not publicly documented; best effort).
 *
 * https://platform.minimax.cn/docs/m-plan/faq
 */
import { PROVIDER_QUOTA_DEFAULT_TIMEOUT_MS } from "./DeepSeekBalance";
import type { ProviderQuotaAccountKind, ProviderQuotaBalance, ProviderQuotaWindow } from "./ProviderQuotaTypes";

/** Default MiniMax API base (China region). */
export const MINIMAX_DEFAULT_API_BASE = "https://api.minimaxi.com/v1";

/** Hosts that serve the quota endpoints, in preference order when api_base is unknown. */
const MINIMAX_QUOTA_HOSTS = ["https://www.minimaxi.com", "https://www.minimax.io", "https://api.minimaxi.com", "https://api.minimax.io"];

/** A MiniMax quota lookup result. */
export interface MiniMaxQuotaResult {
	/** Detected key kind. */
	readonly accountKind: ProviderQuotaAccountKind;
	/** Plan name, if the payload reports one. */
	readonly plan: string | null;
	/** Subscription quota windows. */
	readonly windows: ProviderQuotaWindow[];
	/** Account balances (pay-as-you-go keys only). */
	readonly balances: ProviderQuotaBalance[];
	/** Non-fatal warning, for example a detected key kind without a readable balance. */
	readonly warning?: string;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function decimal(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clampPercent(value: number | null): number | null {
	return value === null ? null : Math.max(0, Math.min(100, value));
}

/**
 * MiniMax reports business failures inside base_resp even with HTTP 200.
 * @param payload - response body to inspect
 */
function businessError(payload: unknown): string | null {
	const body = record(payload);
	const base = record(body?.["base_resp"]);
	if (!base) {
		return null;
	}
	const code = decimal(base["status_code"]);
	if (code === null || code === 0) {
		return null;
	}
	const message = text(base["status_msg"]);
	return message ? `MiniMax ${code}: ${message}` : `MiniMax returned business error ${code}`;
}

/**
 * MiniMax timestamps are milliseconds; accept seconds defensively.
 * @param value - raw timestamp field
 */
function timestamp(value: unknown): string | null {
	const numeric = decimal(value);
	if (numeric === null) {
		return null;
	}
	const milliseconds = numeric < 1e12 ? numeric * 1_000 : numeric;
	const date = new Date(milliseconds);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function categoryLabel(name: string): string {
	const normalized = name.toLowerCase();
	if (normalized === "general") {
		return "MiniMax";
	}
	if (normalized === "video") {
		return "Video";
	}
	return name;
}

function buildWindow(id: string, label: string, remainingPercent: unknown, resetsAt: string | null): ProviderQuotaWindow | null {
	const remaining = clampPercent(decimal(remainingPercent));
	if (remaining === null) {
		return null;
	}
	return {
		id: id,
		label: label,
		used_percent: clampPercent(100 - remaining),
		remaining_percent: remaining,
		resets_at: resetsAt,
	};
}

/**
 * Parse /v1/token_plan/remains.
 *
 * Real payloads carry one model_remains entry per model category, each with a
 * 5-hour window (current_interval_*) and a weekly window (current_weekly_*).
 * The *_remaining_percent fields are the only reliable values: the *_usage_count
 * fields have changed meaning over time and can arrive as 0 while the remaining
 * percentage still reports usage.
 * @param payload - endpoint response body
 */
export function parseMiniMaxTokenPlan(payload: unknown): { plan: string | null; windows: ProviderQuotaWindow[] } {
	const body = record(payload);
	if (!body) {
		return { plan: null, windows: [] };
	}
	const windows: ProviderQuotaWindow[] = [];
	let plan: string | null = text(body["current_subscribe_title"]) ?? text(body["plan_name"]) ?? text(body["plan"]);
	for (const entry of array(body["model_remains"])) {
		const item = record(entry);
		if (!item) {
			continue;
		}
		const modelName = text(item["model_name"]) ?? "general";
		const category = categoryLabel(modelName);
		if (!plan) {
			plan = text(item["current_subscribe_title"]) ?? text(item["plan_name"]);
		}
		// Status 3 means unlimited quota; an unlimited window has no meaningful bar.
		if (decimal(item["current_interval_status"]) !== 3) {
			const interval = buildWindow(
				`${modelName}-5h`,
				`${category} · 5-hour`,
				item["current_interval_remaining_percent"],
				timestamp(item["end_time"]),
			);
			if (interval) {
				windows.push(interval);
			}
		}
		if (decimal(item["current_weekly_status"]) !== 3) {
			const weekly = buildWindow(
				`${modelName}-weekly`,
				`${category} · 7-day`,
				item["current_weekly_remaining_percent"],
				timestamp(item["weekly_end_time"]),
			);
			if (weekly) {
				windows.push(weekly);
			}
		}
	}
	return { plan: plan, windows: windows };
}

/**
 * Build candidate hosts, preferring the configured region.
 * @param apiBase - configured api_base
 */
export function miniMaxQuotaHosts(apiBase: unknown): string[] {
	const hosts: string[] = [];
	if (typeof apiBase === "string" && apiBase.trim().length > 0) {
		try {
			const url = new URL(apiBase.trim());
			hosts.push(`${url.protocol}//${url.host}`);
		} catch {
			// Non-URL api_base falls back to the documented hosts.
		}
	}
	for (const host of MINIMAX_QUOTA_HOSTS) {
		if (!hosts.includes(host)) {
			hosts.push(host);
		}
	}
	return hosts;
}

/**
 * Probe whether the key is accepted at all.
 *
 * /v1/models is authenticated with the same key but does not consume quota, so
 * it distinguishes "valid pay-as-you-go key" from "bad key" even when the
 * undocumented balance endpoint rejects the request.
 * @param host - API host
 * @param apiKey - plaintext key
 * @param timeoutMs - request timeout
 */
async function probeKey(host: string, apiKey: string, timeoutMs: number): Promise<boolean> {
	const response = await fetch(`${host}/v1/models`, {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	return response.ok;
}

async function getJson(url: string, apiKey: string, timeoutMs: number): Promise<unknown> {
	const response = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	const raw = await response.text();
	let payload: unknown = null;
	try {
		payload = JSON.parse(raw) as unknown;
	} catch {
		payload = null;
	}
	if (!response.ok) {
		throw new Error(businessError(payload) ?? `HTTP ${response.status}`);
	}
	return payload;
}

/**
 * Query MiniMax quota and detect the configured key kind.
 *
 * The subscription probe runs first because its endpoint is documented and its
 * windows are what the dashboard renders. A key the subscription probe rejects
 * is treated as pay-as-you-go, whose balance endpoint is best effort.
 * @param apiKey - plaintext key, only alive in this call stack
 * @param apiBase - configured api_base, used to prefer the matching region
 * @param timeoutMs - per-request timeout
 */
export async function fetchMiniMaxQuota(
	apiKey: string,
	apiBase: unknown,
	timeoutMs = PROVIDER_QUOTA_DEFAULT_TIMEOUT_MS,
): Promise<MiniMaxQuotaResult> {
	const hosts = miniMaxQuotaHosts(apiBase);
	let subscriptionError: Error | null = null;

	for (const host of hosts) {
		try {
			const payload = await getJson(`${host}/v1/token_plan/remains`, apiKey, timeoutMs);
			const business = businessError(payload);
			if (business !== null) {
				subscriptionError = new Error(business);
				continue;
			}
			const parsed = parseMiniMaxTokenPlan(payload);
			if (parsed.windows.length > 0) {
				return {
					accountKind: "subscription",
					plan: parsed.plan,
					windows: parsed.windows,
					balances: [],
				};
			}
		} catch (error) {
			subscriptionError = error instanceof Error ? error : new Error(String(error));
		}
	}

	let balanceError: Error | null = null;
	for (const host of hosts) {
		try {
			const payload = await getJson(`${host}/account/query_balance`, apiKey, timeoutMs);
			const business = businessError(payload);
			if (business !== null) {
				balanceError = new Error(business);
				continue;
			}
			const body = record(payload);
			const available = decimal(body?.["available_amount"] ?? body?.["available_balance"] ?? body?.["balance"]);
			if (available !== null) {
				return {
					accountKind: "pay_as_you_go",
					plan: null,
					windows: [],
					balances: [
						{
							label: "MiniMax pay-as-you-go balance",
							remaining: available,
							unit: text(body?.["currency"]) ?? "CNY",
						},
					],
				};
			}
		} catch (error) {
			balanceError = error instanceof Error ? error : new Error(String(error));
		}
	}

	// The balance endpoint is undocumented and may reject a valid key. Fall back
	// to an authentication probe so the card can still name the key kind.
	for (const host of hosts) {
		try {
			if (await probeKey(host, apiKey, timeoutMs)) {
				return {
					accountKind: "pay_as_you_go",
					plan: null,
					windows: [],
					balances: [],
					warning:
						"This is a pay-as-you-go key. MiniMax does not expose a public balance API for it, so only the key kind is shown.",
				};
			}
		} catch {
			// Probe failures are not fatal; fall through to the collected reasons.
		}
	}

	const reasons = [
		subscriptionError === null ? null : `subscription: ${subscriptionError.message}`,
		balanceError === null ? null : `pay-as-you-go: ${balanceError.message}`,
	].filter((value): value is string => value !== null);
	throw new Error(
		reasons.length === 0
			? "MiniMax returned no quota windows or balance"
			: `MiniMax could not read quota for this key (${reasons.join("; ")})`,
	);
}
