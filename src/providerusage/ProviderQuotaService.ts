/**
 * Built-in provider quota service.
 *
 * Responsibilities:
 * 1. Discover DeepSeek / MiniMax accounts from the runtime deployment snapshot,
 *    grouping by credential so one account is queried once.
 * 2. Resolve plaintext keys server-side and query upstream; keys never reach the
 *    response, logs, or error messages.
 * 3. Normalize both providers into the shape the usage page renders.
 */
import type { CredentialValuesAccessor, Deployment } from "../types/router";
import { fetchDeepSeekBalance } from "./DeepSeekBalance";
import { fetchMiniMaxQuota } from "./MiniMaxQuota";
import type { ProviderQuotaAccount } from "./ProviderQuotaTypes";

/** Providers with a quota adapter. */
const SUPPORTED_PROVIDERS = new Set(["deepseek", "minimax"]);

/** Short cache so opening the usage page does not hit providers on every render. */
const CACHE_TTL_MS = 60_000;

interface CachedAccount {
	readonly expiresAt: number;
	readonly account: ProviderQuotaAccount;
}

/** One upstream account to query. */
interface QuotaTarget {
	readonly id: string;
	readonly provider: string;
	readonly label: string;
	readonly models: string[];
	readonly apiKey: string;
	readonly apiBase: unknown;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve the effective provider of a deployment, matching ProviderRegistry
 * precedence: explicit custom_llm_provider first, then the model prefix.
 * @param deployment - runtime deployment
 */
export function resolveProvider(deployment: Deployment): string {
	const custom = stringValue(deployment.litellm_params.custom_llm_provider);
	if (custom !== null) {
		return custom.toLowerCase();
	}
	const model = deployment.litellm_params.model;
	if (typeof model !== "string") {
		return "";
	}
	const slash = model.indexOf("/");
	if (slash > 0) {
		return model.slice(0, slash).toLowerCase();
	}
	const lower = model.toLowerCase();
	if (lower.startsWith("deepseek")) {
		return "deepseek";
	}
	if (lower.startsWith("minimax")) {
		return "minimax";
	}
	return "";
}

/**
 * Credential values override inline params, matching execution-time resolution.
 * @param deployment - deployment whose params are resolved
 * @param credentials - runtime credential accessor
 */
function effectiveParams(deployment: Deployment, credentials: CredentialValuesAccessor | undefined): Record<string, unknown> {
	const inline = deployment.litellm_params as unknown as Record<string, unknown>;
	const credentialName = stringValue(inline["litellm_credential_name"]);
	if (credentialName === null) {
		return inline;
	}
	const values = credentials?.getValues(credentialName);
	return values === undefined ? inline : { ...inline, ...values };
}

/**
 * Mask a key for display; the full key never leaves the server.
 * @param apiKey - plaintext key
 */
function maskKey(apiKey: string): string {
	const trimmed = apiKey.trim();
	return trimmed.length <= 8 ? "••••" : `••••${trimmed.slice(-4)}`;
}

/**
 * Build query targets from deployments.
 *
 * One credential may serve several model groups, so targets are grouped by
 * provider + credential + api_base and queried once. Deployments without a
 * usable key are skipped: there is nothing to query and no account to show.
 * @param deployments - deployments from the request snapshot
 * @param credentials - runtime credential accessor
 */
export function buildQuotaTargets(
	deployments: readonly Deployment[],
	credentials: CredentialValuesAccessor | undefined,
): QuotaTarget[] {
	interface TargetBuilder {
		readonly provider: string;
		readonly label: string;
		readonly models: Set<string>;
		readonly apiKey: string;
		readonly apiBase: unknown;
	}
	const targets = new Map<string, TargetBuilder>();
	for (const deployment of deployments) {
		const provider = resolveProvider(deployment);
		if (!SUPPORTED_PROVIDERS.has(provider)) {
			continue;
		}
		const params = effectiveParams(deployment, credentials);
		const apiKey = stringValue(params["api_key"]);
		if (apiKey === null) {
			continue;
		}
		const credentialName = stringValue(params["litellm_credential_name"]);
		const apiBase = params["api_base"];
		const label = credentialName ?? maskKey(apiKey);
		// The identity deliberately excludes the key itself: only a masked suffix
		// may appear in an id that reaches the dashboard.
		const identity = `${provider}:${credentialName ?? maskKey(apiKey)}:${apiBase === undefined ? "" : String(apiBase)}`;
		const existing = targets.get(identity);
		if (existing) {
			existing.models.add(deployment.model_name);
			continue;
		}
		targets.set(identity, {
			provider: provider,
			label: label,
			models: new Set([deployment.model_name]),
			apiKey: apiKey,
			apiBase: apiBase,
		});
	}
	return [...targets.entries()].map(([identity, target]) => ({
		id: identity,
		provider: target.provider,
		label: target.label,
		models: [...target.models].sort(),
		apiKey: target.apiKey,
		apiBase: target.apiBase,
	}));
}

async function queryTarget(target: QuotaTarget): Promise<ProviderQuotaAccount> {
	const fetchedAt = new Date().toISOString();
	if (target.provider === "deepseek") {
		const result = await fetchDeepSeekBalance(target.apiKey, target.apiBase);
		return {
			id: target.id,
			provider: target.provider,
			label: target.label,
			models: target.models,
			account_kind: "pay_as_you_go",
			plan: null,
			subscription_expires_at: null,
			windows: [],
			balances: result.balances,
			...(result.available === false ? { warning: "DeepSeek reports this account cannot serve API calls" } : {}),
			fetched_at: fetchedAt,
		};
	}
	const result = await fetchMiniMaxQuota(target.apiKey, target.apiBase);
	return {
		id: target.id,
		provider: target.provider,
		label: target.label,
		models: target.models,
		account_kind: result.accountKind,
		plan: result.plan,
		subscription_expires_at: null,
		windows: result.windows,
		balances: result.balances,
		...(result.warning === undefined ? {} : { warning: result.warning }),
		fetched_at: fetchedAt,
	};
}

/** Queries quota for every discoverable built-in provider account. */
export class ProviderQuotaService {
	private readonly _cache = new Map<string, CachedAccount>();

	/**
	 * Return quota for all supported accounts in the current snapshot.
	 * A single failing account never fails the whole list; it is returned with an
	 * error so the user can tell a wrong key kind from a transient outage.
	 * @param credentials - credential accessor from the request snapshot
	 * @param deployments - deployments from the request snapshot
	 * @param force - bypass the short-lived cache
	 */
	async list(
		credentials: CredentialValuesAccessor | undefined,
		deployments: readonly Deployment[],
		force = false,
	): Promise<ProviderQuotaAccount[]> {
		const targets = buildQuotaTargets(deployments, credentials);
		const now = Date.now();
		const accounts = await Promise.all(
			targets.map(async (target) => {
				const cached = this._cache.get(target.id);
				const sameModels = cached !== undefined && cached.account.models.join("\u0000") === target.models.join("\u0000");
				if (!force && cached !== undefined && sameModels && cached.expiresAt > now) {
					return cached.account;
				}
				let account: ProviderQuotaAccount;
				try {
					account = await queryTarget(target);
				} catch (error) {
					account = {
						id: target.id,
						provider: target.provider,
						label: target.label,
						models: target.models,
						account_kind: "unknown",
						plan: null,
						subscription_expires_at: null,
						windows: [],
						balances: [],
						fetched_at: new Date().toISOString(),
						error: error instanceof Error ? error.message : String(error),
					};
				}
				this._cache.set(target.id, { expiresAt: now + CACHE_TTL_MS, account: account });
				return account;
			}),
		);
		return accounts.sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label));
	}
}
