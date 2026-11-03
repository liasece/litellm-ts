/**
 * DeepSeek account balance.
 *
 * The only public endpoint is `GET /user/balance`, which reports account-level
 * balance (granted plus topped-up). DeepSeek has no public API for per-key or
 * per-model usage history, so this adapter reports balance only.
 * https://api-docs.deepseek.com/zh-cn/api/get-user-balance/
 */
import type { ProviderQuotaBalance } from "./ProviderQuotaTypes";

/** Default DeepSeek API base. */
export const DEEPSEEK_DEFAULT_API_BASE = "https://api.deepseek.com";

/** Timeout for one provider quota request. */
export const PROVIDER_QUOTA_DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Normalize an api_base so it can be joined with `/user/balance`.
 * @param value - configured api_base
 */
export function normalizeDeepSeekApiBase(value: unknown): string {
	if (typeof value !== "string") {
		return DEEPSEEK_DEFAULT_API_BASE;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return DEEPSEEK_DEFAULT_API_BASE;
	}
	return trimmed
		.replace(/\/+$/, "")
		.replace(/\/(?:anthropic\/v1\/messages|anthropic|beta|v1|chat\/completions|responses|user\/balance)$/, "");
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

/**
 * Convert a DeepSeek balance payload into balance rows.
 *
 * An account may hold both CNY and USD wallets, so each wallet becomes its own
 * row instead of being summed into a single misleading number.
 * @param payload - `/user/balance` response body
 */
export function normalizeDeepSeekBalance(payload: unknown): ProviderQuotaBalance[] {
	const body = record(payload);
	if (!body) {
		return [];
	}
	const infos = Array.isArray(body["balance_infos"]) ? body["balance_infos"] : [];
	const balances: ProviderQuotaBalance[] = [];
	for (const info of infos) {
		const entry = record(info);
		if (!entry) {
			continue;
		}
		const currency = typeof entry["currency"] === "string" && entry["currency"].trim().length > 0 ? entry["currency"].trim() : "CNY";
		const total = decimal(entry["total_balance"]);
		if (total === null) {
			continue;
		}
		const granted = decimal(entry["granted_balance"]);
		const toppedUp = decimal(entry["topped_up_balance"]);
		const details: string[] = [];
		if (granted !== null) {
			details.push(`Granted ${granted.toFixed(2)}`);
		}
		if (toppedUp !== null) {
			details.push(`Topped up ${toppedUp.toFixed(2)}`);
		}
		balances.push({
			label: `DeepSeek balance (${currency})`,
			remaining: total,
			unit: currency,
			details: details.length > 0 ? details : undefined,
		});
	}
	return balances;
}

/** Parsed DeepSeek balance payload. */
export interface DeepSeekBalanceResult {
	/** Balance rows. */
	readonly balances: ProviderQuotaBalance[];
	/** Whether the account can currently serve API calls. */
	readonly available: boolean | null;
}

/**
 * Parse a DeepSeek balance payload.
 * @param payload - `/user/balance` response body
 */
export function parseDeepSeekBalance(payload: unknown): DeepSeekBalanceResult {
	const body = record(payload);
	const available = typeof body?.["is_available"] === "boolean" ? (body["is_available"] as boolean) : null;
	return { balances: normalizeDeepSeekBalance(payload), available: available };
}

/**
 * Query the DeepSeek account balance.
 * @param apiKey - plaintext key, only alive in this call stack
 * @param apiBase - configured api_base, or undefined for the official host
 * @param timeoutMs - request timeout
 */
export async function fetchDeepSeekBalance(
	apiKey: string,
	apiBase: unknown,
	timeoutMs = PROVIDER_QUOTA_DEFAULT_TIMEOUT_MS,
): Promise<DeepSeekBalanceResult> {
	const response = await fetch(`${normalizeDeepSeekApiBase(apiBase)}/user/balance`, {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`DeepSeek balance query failed (HTTP ${response.status})`);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(text) as unknown;
	} catch {
		throw new Error("DeepSeek balance response is not valid JSON");
	}
	const result = parseDeepSeekBalance(payload);
	if (result.balances.length === 0) {
		throw new Error("DeepSeek balance response contained no balance entries");
	}
	return result;
}
