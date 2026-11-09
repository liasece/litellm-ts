import { ApiError } from "../core/api/ApiError";
import { LlmProviders } from "../types/provider";

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
/** Deployment fields used to select the account source. */
export interface SubscriptionModelParams {
	/** Configured upstream model with an optional provider prefix. */
	readonly model?: unknown;
	/** Explicit provider override from the deployment. */
	readonly custom_llm_provider?: unknown;
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
export function hostedProvider(params: SubscriptionModelParams): SubscriptionProvider | undefined {
	const explicit = typeof params.custom_llm_provider === "string" ? params.custom_llm_provider.trim().toLowerCase() : "";
	const model = typeof params.model === "string" ? params.model : "";
	const candidate = explicit || (model.includes("/") ? model.split("/", 1)[0]?.toLowerCase() : undefined);
	return isSubscriptionProvider(candidate) ? candidate : undefined;
}

/**
 * Accept a provider-qualified model at the configuration boundary and retain its actual vendor path.
 * @param model - User-supplied upstream model.
 * @param provider - Account source selected independently of the name.
 */
export function withoutProvider(model: string, provider: SubscriptionProvider): string {
	return model.toLowerCase().startsWith(provider + "/") ? model.slice(provider.length + 1) : model;
}

/**
 * Canonical fields shared by model creation, model updates and YAML imports.
 * @param params - A complete deployment configuration after merging a PATCH.
 * @throws If the retired generic source is requested or the upstream ID is missing.
 */
export function subscriptionModelParams(params: Record<string, unknown>): Record<string, unknown> {
	const model = typeof params["model"] === "string" ? params["model"].trim() : "";
	const explicit = typeof params["custom_llm_provider"] === "string" ? params["custom_llm_provider"].trim().toLowerCase() : "";
	if (explicit === "cliproxy" || /^cliproxy\//i.test(model) || Object.hasOwn(params, "subscription_transport")) {
		throw ApiError.badRequest("请选择具体订阅 Provider，并填写上游模型 ID");
	}
	const provider = hostedProvider(params);
	if (!provider) {
		return params;
	}
	const upstream = withoutProvider(model, provider);
	if (
		!upstream ||
		/^cliproxy\//i.test(upstream) ||
		(upstream.includes("/") && isSubscriptionProvider(upstream.split("/", 1)[0]?.toLowerCase()))
	) {
		throw ApiError.badRequest("订阅模型需要独立的 Provider 和上游模型 ID");
	}
	const result = { ...params, model: upstream, custom_llm_provider: provider } as Record<string, unknown>;
	if ("litellm_model_name" in result) {
		result["litellm_model_name"] = upstream;
	}
	for (const field of ["api_base", "api_key", "litellm_credential_name", "credential_name"]) {
		delete result[field];
	}
	return result;
}

/**
 * Keep model metadata references consistent with the stored deployment, preserving independent price overrides.
 * @param info - Model metadata copied from an input or merged update.
 * @param params - Canonical deployment parameters.
 */
export function subscriptionModelInfo(info: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
	const source = hostedProvider(params);
	if (!source) {
		return info;
	}
	const result = { ...info };
	for (const key of ["key", "base_model"]) {
		const value = result[key];
		if (typeof value === "string") {
			result[key] = withoutProvider(value.replace(/^cliproxy\//i, ""), source);
		}
	}
	if (result["litellm_provider"] === "cliproxy") {
		result["litellm_provider"] = source;
	}
	return result;
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
}

/** Process-local transport and source registry for the subscription worker. */
export interface SubscriptionConnection {
	/** Worker's private HTTP base URL. */
	readonly baseUrl: string;
	/** Ingress credential for the private listener. */
	readonly internalApiKey: string;
	/** Latest provider registrations for this worker. */
	readonly subscriptionCatalog?: SubscriptionCatalog;
}

const SCOPED_PATHS = new Set([
	"/v1/responses",
	"/v1/chat/completions",
	"/v1/messages",
	"/v1/images/generations",
	"/v1/images/edits",
	"/v1/completions",
	"/v1/responses/compact",
	"/v1/messages/count_tokens",
	"/v1beta/interactions",
]);

/**
 * Resolve the account source once for both the request URL and its model ID.
 * @param connection
 * @param params
 * @param path
 * @throws If the selected account source cannot execute this operation.
 */
export function subscriptionTarget(
	connection: SubscriptionConnection,
	params: SubscriptionModelParams,
	path: string,
): { url: string; model: string } {
	const provider = hostedProvider(params);
	if (!provider || typeof params.model !== "string") {
		throw ApiError.badRequest("订阅请求缺少 Provider 或上游模型 ID");
	}
	const model = withoutProvider(params.model, provider);
	const pathname = path.split("?", 1)[0]!;
	const base = connection.baseUrl.replace(/\/+$/, "");
	if (SCOPED_PATHS.has(pathname) || pathname.startsWith("/v1beta/models/")) {
		return { url: base + "/subscriptions/" + provider + path, model: model };
	}
	const codexOnly = pathname === "/v1/alpha/search" || /^\/v1\/(?:live|realtime)(?:\/|$)/.test(pathname);
	const xaiOnly = /^\/v1\/videos(?:\/|$)/.test(pathname);
	if ((codexOnly && provider !== LlmProviders.CodexSubscription) || (xaiOnly && provider !== LlmProviders.XaiSubscription)) {
		throw ApiError.badRequest("所选订阅不提供此接口");
	}
	// The SDK binds calls and generated resources to the account that created them.
	if (pathname && !codexOnly && !xaiOnly && connection.subscriptionCatalog?.owner(model) !== provider) {
		throw ApiError.unavailable("无法确定此操作对应的订阅账号来源");
	}
	return { url: base + path, model: model };
}
