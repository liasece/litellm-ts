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
 * 对齐 PY: fallbacks 是 List[Dict[str, List[str]]]，合并时 first-match-wins。
 */
export class FallbackHandler {
	private _fallbacks: Record<string, string[]>;
	// DIFF-RT-ALIAS-01: alias 值类型扩展为 string | string[] | { model, hidden? }
	// 之前只支持 string | object，string[] 多值数组报 TS 错。
	private _modelGroupAlias: Record<string, string | string[] | { model: string; hidden?: boolean }>;
	private _contextWindowFallbacks: Record<string, string[]>;
	private _contentPolicyFallbacks: Record<string, string[]>;
	/** 内部缓存：getFallbackChain 计算结果，避免重复计算 */
	private _chainCache: Map<string, string[]> = new Map();

	constructor(
		/** PY 风格：fallbacks 是 List[Dict]，first-match-wins 合并 */
		fallbacks?: Array<Record<string, string[]>> | Record<string, string[]>,
		modelGroupAlias?: Record<string, string | string[] | { model: string; hidden?: boolean }>,
		contextWindowFallbacks?: Record<string, string[]>,
		contentPolicyFallbacks?: Record<string, string[]>,
	) {
		this._fallbacks = this._mergeFallbacks(fallbacks);
		this._modelGroupAlias = modelGroupAlias ?? {};
		this._contextWindowFallbacks = contextWindowFallbacks ?? {};
		this._contentPolicyFallbacks = contentPolicyFallbacks ?? {};
	}

	/**
	 * 合并 fallbacks。PY 行为：List[Dict] 顺序遍历，first-match-wins。
	 * 也兼容直接传入 Record<string, string[]>。
	 * @param fallbacks
	 */
	private _mergeFallbacks(fallbacks?: Array<Record<string, string[]>> | Record<string, string[]>): Record<string, string[]> {
		if (!fallbacks) {
			return {};
		}
		const merged: Record<string, string[]> = {};
		if (Array.isArray(fallbacks)) {
			for (const fb of fallbacks) {
				for (const [key, vals] of Object.entries(fb)) {
					if (!(key in merged)) {
						merged[key] = vals;
					}
				}
			}
		} else {
			Object.assign(merged, fallbacks);
		}
		return merged;
	}

	/**
	 * 已知 provider 前缀列表，对齐 PY litellm.provider_list
	 * （fallback_event_handlers._check_stripped_model_group 遍历枚举）
	 * GAP: PY 实际是动态 Enum，包含 100+ provider；TS 静态列表虽不全，但已涵盖主流
	 * 现补充：xai, anthropic_beta, text-completion-openai, jina_ai, friendliai, galadriel,
	 *        github, gitlab, lemonade, lm_studio, moonshot, nebius, novita, oci, oxylabs,
	 *        recraft, snowflake, tavily, topaz, triton, volcengine, wandb_integration, etc.
	 */
	private static readonly _knownProviders: readonly string[] = [
		"openai",
		"text-completion-openai",
		"anthropic",
		"anthropic_beta",
		"azure",
		"azure_ai",
		"bedrock",
		"cohere",
		"cohere_chat",
		"vertex_ai-language-models",
		"vertex_ai-anthropic_models",
		"vertex_ai-chat-models",
		"vertex_ai-code-chat-models",
		"vertex_ai-code-text-models",
		"vertex_ai-embedding-models",
		"vertex_ai-image-models",
		"vertex_ai-text-models",
		"vertex_ai-text-embedding-models",
		"vertex_ai-vision-models",
		"gemini",
		"gemini_cli",
		"huggingface",
		"together_ai",
		"openrouter",
		"replicate",
		"ai21",
		"aleph_alpha",
		"anyscale",
		"baseten",
		"custom",
		"custom_openai",
		"deepinfra",
		"deepseek",
		"fireworks_ai",
		"friendliai",
		"galadriel",
		"glm",
		"mimo",
		"mistral",
		"groq",
		"xai",
		"github",
		"gitlab",
		"jina_ai",
		"lemonade",
		"lm_studio",
		"moonshot",
		"nebius",
		"novita",
		"nlp_cloud",
		"oci",
		"ollama",
		"openllm",
		"oxylabs",
		"perplexity",
		"petals",
		"predibase",
		"recraft",
		"sagemaker",
		"snowflake",
		"tavily",
		"topaz",
		"triton",
		"vllm",
		"volcengine",
		"voyage",
		"wandb_integration",
		"watsonx",
	];

	/**
	 * 剥离 provider 前缀（对齐 PY _check_stripped_model_group 行为）：
	 * 仅当斜杠前是已知 provider 前缀时才剥离。避免误把用户模型名
	 * 中包含 "/" 的情况当成 provider 前缀。
	 * GAP: PY `model_group.startswith(f"{_provider}/")` 是大小写敏感比较（fallback_event_handlers.py:38-39）
	 * TS 之前用 lowercase 比较，现改为 case-sensitive
	 * @param model
	 */
	private _stripProviderPrefix(model: string): string {
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			const prefix = model.slice(0, slashIdx);
			// GAP: case-sensitive 比较 (PY 行为)
			if (FallbackHandler._knownProviders.includes(prefix)) {
				return model.slice(slashIdx + 1);
			}
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
	 * GAP: RouterModelGroupAliasValue 支持 string[] (types/router.ts:105) 但 Router 内部未采用
	 * 现支持 string[] 多值：返回第一个 (与 PY RouterModelGroupAliasValue 行为一致)
	 * @param model
	 */
	private _resolveAlias(model: string): string {
		const alias = this._modelGroupAlias[model];
		if (typeof alias === "string") {
			return alias;
		}
		if (Array.isArray(alias)) {
			// PY: 多值别名取第一个
			return alias[0] ?? model;
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
	 * 结果带缓存，避免 hasMoreFallbacks/getNextFallback 重复计算
	 * @param model - original model name
	 * @returns ordered fallback chain (excluding the original model)
	 */
	getFallbackChain(model: string): string[] {
		const cached = this._chainCache.get(model);
		if (cached) {
			return cached;
		}
		// DIFF-RT-02: 对齐 PY `router.py:5842-5870` 的双层查找 + alias 解析
		//   1) 先查 model 字面量 + provider 前缀剥离匹配
		//   2) 未命中再回退到 alias 解析后的底层 group（_resolveModelGroup）
		//   3) 再回退到 wildcard '*' 通配
		// 复用 _lookupFallback 但把 alias 解析和 wildcard 路径都覆盖
		const directFallbacks = this._lookupFallback(model, this._fallbacks);

		if (directFallbacks.length === 0) {
			this._chainCache.set(model, []);
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

		this._chainCache.set(model, chain);
		return chain;
	}

	/**
	 * DIFF-RT-02: 把 alias 解析为底层 model group，对齐 PY
	 * `router.py:5905-5918 self._get_model_from_alias`。
	 * 如果 `model` 已经是底层 group（无 alias），原样返回。
	 * @param model
	 */
	resolveModelGroup(model: string): string {
		return this._resolveAlias(model);
	}

	/**
	 * Invalidate the chain cache (e.g., when fallbacks are mutated at runtime)
	 */
	invalidateCache(): void {
		this._chainCache.clear();
	}

	/**
	 * 运行时替换 fallback 映射（对齐 PY Router.update_settings 的 fallbacks 热更新）。
	 * 接受 PY 风格 List[Dict]（first-match-wins 合并）或 Record；替换后失效链缓存。
	 * @param fallbacks - 新的 fallback 配置
	 */
	setFallbacks(fallbacks?: Array<Record<string, string[]>> | Record<string, string[]>): void {
		this._fallbacks = this._mergeFallbacks(fallbacks);
		this.invalidateCache();
	}

	/**
	 * 读取当前 fallback 配置（合并后的 Record 视图，等价 PY Router.fallbacks 运行时值）。
	 * 供管理端点按 model_group 反查展示（PY get_all_fallbacks 的数据源）。
	 * 返回深拷贝，避免外部改写内部状态。
	 */
	getFallbacks(): Record<string, string[]> {
		return Object.fromEntries(Object.entries(this._fallbacks).map(([key, chain]) => [key, [...chain]]));
	}

	/**
	 * 运行时替换 context window fallback 映射（PY update_settings 白名单项）。
	 * @param fallbacks - 新的 context window fallback 配置
	 */
	setContextWindowFallbacks(fallbacks?: Record<string, string[]>): void {
		this._contextWindowFallbacks = fallbacks ?? {};
		this.invalidateCache();
	}

	/**
	 * 运行时替换 model_group_alias（PY update_settings 白名单项）。
	 * @param modelGroupAlias - 新的别名映射
	 */
	setModelGroupAlias(modelGroupAlias?: Record<string, string | string[] | { model: string; hidden?: boolean }>): void {
		this._modelGroupAlias = modelGroupAlias ?? {};
		this.invalidateCache();
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
