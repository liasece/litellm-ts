/**
 * Fallback Handler
 *
 * Manages fallback chains for model requests.
 * Supports model_group_alias resolution (Patch 14).
 */

/**
 * Fallback Handler
 *
 * 管理模型请求的回退链，支持上下文窗口溢出和内容策略违规的专属回退。
 */
export class FallbackHandler {
	private _fallbacks: Record<string, string[]>;
	private _modelGroupAlias: Record<string, string | { model: string; hidden?: boolean }>;
	private _contextWindowFallbacks: Record<string, string[]>;
	private _contentPolicyFallbacks: Record<string, string[]>;

	constructor(
		fallbacks?: Record<string, string[]>,
		modelGroupAlias?: Record<string, string | { model: string; hidden?: boolean }>,
		contextWindowFallbacks?: Record<string, string[]>,
		contentPolicyFallbacks?: Record<string, string[]>,
	) {
		this._fallbacks = fallbacks ?? {};
		this._modelGroupAlias = modelGroupAlias ?? {};
		this._contextWindowFallbacks = contextWindowFallbacks ?? {};
		this._contentPolicyFallbacks = contentPolicyFallbacks ?? {};
	}

	/**
	 * Strip provider prefix from model name (e.g., "openai/gpt-4" -> "gpt-4")
	 * @param model
	 */
	private _stripProviderPrefix(model: string): string {
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			return model.slice(slashIdx + 1);
		}
		return model;
	}

	/**
	 * Lookup in the given fallback map with fallback resolution:
	 * 1. Exact model name match
	 * 2. Provider-prefix stripped match
	 * 3. Wildcard '*' match
	 * @param model
	 * @param fallbackMap
	 */
	private _lookupFallback(model: string, fallbackMap: Record<string, string[]>): string[] {
		// Exact match
		const exact = fallbackMap[model];
		if (exact) {
			return exact;
		}
		// Provider-prefix stripped match
		const stripped = this._stripProviderPrefix(model);
		if (stripped !== model) {
			const strippedMatch = fallbackMap[stripped];
			if (strippedMatch) {
				return strippedMatch;
			}
		}
		// Resolve alias and try again
		const resolvedAlias = this._resolveAlias(model);
		if (resolvedAlias !== model) {
			// Exact match on resolved alias
			const aliasMatch = fallbackMap[resolvedAlias];
			if (aliasMatch) {
				return aliasMatch;
			}
			// Provider-prefix stripped match on resolved alias (对齐 PY get_fallback_model_group)
			const strippedAlias = this._stripProviderPrefix(resolvedAlias);
			if (strippedAlias !== resolvedAlias) {
				const strippedAliasMatch = fallbackMap[strippedAlias];
				if (strippedAliasMatch) {
					return strippedAliasMatch;
				}
			}
		}
		// Wildcard match
		const wildcard = fallbackMap["*"];
		if (wildcard) {
			return wildcard;
		}
		return [];
	}

	/**
	 * Get context window fallback chain for a model
	 * @param model - original model name
	 * @returns ordered context window fallback chain
	 */
	getContextWindowFallbackChain(model: string): string[] {
		return this._lookupFallback(model, this._contextWindowFallbacks);
	}

	/**
	 * Get content policy fallback chain for a model
	 * @param model - original model name
	 * @returns ordered content policy fallback chain
	 */
	getContentPolicyFallbackChain(model: string): string[] {
		return this._lookupFallback(model, this._contentPolicyFallbacks);
	}

	/**
	 * Resolve model_group_alias before fallback lookup (Patch 14)
	 * @param model
	 */
	private _resolveAlias(model: string): string {
		const alias = this._modelGroupAlias[model];
		if (typeof alias === "string") {
			return alias;
		}
		if (alias && typeof alias === "object" && "model" in alias) {
			return alias.model;
		}
		return model;
	}

	/**
	 * Get the fallback chain for a model, resolving aliases first.
	 * The chain is ordered: first resolved alias, then direct fallbacks,
	 * then recursively resolved fallback aliases.
	 * 支持通配符 * 匹配和 provider 前缀剥离匹配（对齐 PY fallback_event_handlers.py）。
	 * @param model - original model name
	 * @returns ordered fallback chain (excluding the original model)
	 */
	getFallbackChain(model: string): string[] {
		const directFallbacks = this._lookupFallback(model, this._fallbacks);

		if (directFallbacks.length === 0) {
			return [];
		}

		// Resolve each fallback through aliases
		const chain: string[] = [];
		const seen = new Set<string>([model]);

		for (const fb of directFallbacks) {
			const resolved = this._resolveAlias(fb);
			if (!seen.has(resolved)) {
				chain.push(resolved);
				seen.add(resolved);
			}
		}

		return chain;
	}

	/**
	 * Check if there are more fallbacks available at the given depth
	 * @param model - original model name
	 * @param currentDepth - current position in the fallback chain
	 * @returns true if more fallbacks exist
	 */
	hasMoreFallbacks(model: string, currentDepth: number): boolean {
		const chain = this.getFallbackChain(model);
		return currentDepth < chain.length;
	}

	/**
	 * Get the next fallback model in the chain
	 * @param model - original model name
	 * @param currentDepth - current position in the fallback chain
	 * @returns the next fallback model or null if none available
	 */
	getNextFallback(model: string, currentDepth: number): string | null {
		const chain = this.getFallbackChain(model);
		if (currentDepth >= chain.length) {
			return null;
		}
		return chain[currentDepth] ?? null;
	}
}
