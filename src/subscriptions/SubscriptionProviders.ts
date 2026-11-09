import { ApiError } from "../core/api/ApiError";
import { LlmProviders } from "../types/provider";
import type { Deployment } from "../types/router";

/** Public provider IDs and their account sources in the subscription runtime. */
export const SUBSCRIPTION_PROVIDERS = {
	[LlmProviders.CodexSubscription]: { name: "Codex Subscription", source: "codex" },
	[LlmProviders.CommandCode]: { name: "CommandCode", source: "commandcode" },
	[LlmProviders.OpenCodeGo]: { name: "OpenCode Go", source: "opencode-go" },
	[LlmProviders.KimiSubscription]: { name: "Kimi Subscription", source: "kimi" },
	[LlmProviders.ClaudeSubscription]: { name: "Claude Subscription", source: "claude" },
	[LlmProviders.AntigravitySubscription]: { name: "Antigravity Subscription", source: "antigravity" },
	[LlmProviders.XaiSubscription]: { name: "xAI Subscription", source: "xai" },
} as const;

/** Public subscription provider slug. */
export type SubscriptionProvider = keyof typeof SUBSCRIPTION_PROVIDERS;
/** An explicit subscription or the legacy resolver. */
export type HostedProvider = SubscriptionProvider | LlmProviders.CLIProxy;
/** Deployment fields used to select the account source. */
export interface SubscriptionModelParams {
	/** Configured upstream model with an optional provider prefix. */
	readonly model?: unknown;
	/** Explicit provider override from the deployment. */
	readonly custom_llm_provider?: unknown;
	/** Administrator-selected compatibility transport for this deployment. */
	readonly subscription_transport?: unknown;
}

/**
 * @param value
 */
export function isSubscriptionProvider(value: unknown): value is SubscriptionProvider {
	return typeof value === "string" && Object.hasOwn(SUBSCRIPTION_PROVIDERS, value);
}

/**
 * An explicit deployment provider takes precedence over the first model segment.
 * @param params
 */
export function hostedProvider(params: SubscriptionModelParams): HostedProvider | undefined {
	const explicit = typeof params.custom_llm_provider === "string" ? params.custom_llm_provider.trim() : "";
	const model = typeof params.model === "string" ? params.model : "";
	const prefix = model.includes("/") || model === LlmProviders.CLIProxy ? model.split("/", 1)[0] : "";
	const name = (explicit || prefix || "").toLowerCase();
	return isSubscriptionProvider(name) || name === LlmProviders.CLIProxy ? name : undefined;
}

/**
 * Remove only the known transport prefix. A vendor segment inside a model ID is significant.
 * @param model
 * @param provider
 */
export function withoutProvider(model: string, provider: HostedProvider): string {
	return model.startsWith(provider + "/") ? model.slice(provider.length + 1) : model;
}

/** One model and every account source that currently registers it. */
export interface CatalogEntry {
	/** Exact identifier published by the runtime. */
	readonly id: string;
	/** Sources that can execute this identifier. */
	readonly providers: readonly string[];
}

const BY_SOURCE = new Map<string, SubscriptionProvider>(
	Object.entries(SUBSCRIPTION_PROVIDERS).map(([id, info]) => [info.source, id as SubscriptionProvider]),
);

/** Runtime registrations, including other plugins that might publish the same model ID. */
export class SubscriptionCatalog {
	private _sources = new Map<string, readonly string[]>();

	/**
	 * @param entries
	 */
	replace(entries: readonly CatalogEntry[]): void {
		this._sources = new Map(entries.map(({ id, providers }) => [id, providers]));
	}

	/**
	 * @param model
	 */
	owner(model: string): SubscriptionProvider | undefined {
		const sources = this._sources.get(model);
		return sources?.length === 1 ? BY_SOURCE.get(sources[0]!) : undefined;
	}

	/**
	 * @param provider
	 * @param model
	 */
	wireModel(provider: HostedProvider, model: string): string {
		const stored = withoutProvider(model, LlmProviders.CLIProxy);
		if (provider === LlmProviders.CLIProxy) {
			return stored;
		}
		const id = withoutProvider(stored, provider);
		// The two plugins publish prefixed IDs by default, but operators can
		// disable or customize that prefix. The current catalog decides.
		if (provider === LlmProviders.CommandCode || provider === LlmProviders.OpenCodeGo) {
			const qualified = provider + "/" + id;
			if (this._sources.get(qualified)?.includes(SUBSCRIPTION_PROVIDERS[provider].source)) {
				return qualified;
			}
			if (this._sources.get(id)?.includes(SUBSCRIPTION_PROVIDERS[provider].source)) {
				return id;
			}
			return qualified;
		}
		return id;
	}

	/**
	 * Project stored legacy deployments at request time without changing their IDs or database rows.
	 * @param deployment
	 */
	deployment(deployment: Deployment): Deployment {
		const params = deployment.litellm_params;
		if (hostedProvider(params) !== LlmProviders.CLIProxy || params.subscription_transport === "compatibility") {
			return deployment;
		}
		const id = withoutProvider(params.model, LlmProviders.CLIProxy);
		const provider = this.owner(id);
		if (!provider) {
			return deployment;
		}
		return {
			...deployment,
			// Prices, historic Logs filters and model policies can refer to the
			// exact stored model. Only the executing account source changes.
			litellm_params: { ...params, custom_llm_provider: provider },
		};
	}
}

/** Process-local transport and source registry for the subscription worker. */
export interface SubscriptionConnection {
	/** Worker's private HTTP base URL. */
	readonly baseUrl: string;
	/** Ingress credential for the private listener. */
	readonly internalApiKey: string;
	/** Whether the running worker supports provider-qualified routes. */
	readonly sourceBuiltSubscriptions?: boolean;
	/** Latest provider registrations for this worker. */
	readonly subscriptionCatalog?: SubscriptionCatalog;
}

const DEFAULT_CATALOG = new SubscriptionCatalog();
const SCOPED_PATHS = new Set([
	"/v1/responses",
	"/v1/chat/completions",
	"/v1/messages",
	"/v1/images/generations",
	"/v1/images/edits",
	"/v1/completions",
	"/v1/responses/compact",
	"/v1/messages/count_tokens",
]);

/**
 * Resolve the account source once for both the request URL and its model ID.
 * @param connection
 * @param params
 * @param path
 * @throws If an older runtime cannot bind an explicit subscription to this model.
 */
export function subscriptionTarget(
	connection: SubscriptionConnection,
	params: SubscriptionModelParams,
	path: string,
): { url: string; model: string } {
	const provider = hostedProvider(params) ?? LlmProviders.CLIProxy;
	const catalog = connection.subscriptionCatalog ?? DEFAULT_CATALOG;
	const model = catalog.wireModel(provider, typeof params.model === "string" ? params.model : "");
	const owner = provider === LlmProviders.CLIProxy ? catalog.owner(model) : provider;
	const base = connection.baseUrl.replace(/\/+$/, "");
	const pathname = path.split("?", 1)[0]!;
	const compatibility = params.subscription_transport === "compatibility" || connection.sourceBuiltSubscriptions === false;
	// Some SDK routes address a specific service or recover the account that owns an
	// existing video or live call. Honor those bindings for new explicit deployments.
	if (provider !== LlmProviders.CLIProxy && !(typeof params.model === "string" && params.model.startsWith("cliproxy/"))) {
		const codexOnly = pathname === "/v1/alpha/search" || /^\/v1\/(?:live|realtime)(?:\/|$)/.test(pathname);
		const xaiOnly = /^\/v1\/videos(?:\/|$)/.test(pathname);
		if ((codexOnly && provider !== LlmProviders.CodexSubscription) || (xaiOnly && provider !== LlmProviders.XaiSubscription)) {
			throw ApiError.badRequest("所选订阅不提供此接口");
		}
	}
	if (
		path &&
		(compatibility || (connection.sourceBuiltSubscriptions && !SCOPED_PATHS.has(pathname))) &&
		provider !== LlmProviders.CLIProxy &&
		catalog.owner(model) !== provider
	) {
		throw ApiError.unavailable("当前兼容运行时无法唯一确定此模型的订阅账号来源");
	}
	const route =
		!compatibility && connection.sourceBuiltSubscriptions && owner && SCOPED_PATHS.has(pathname)
			? "/subscriptions/" + owner + path
			: path;
	return { url: base + route, model: model };
}
