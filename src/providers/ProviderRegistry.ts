/**
 * Provider Registry
 *
 * Provider 注册表/工厂，支持 "provider/model" 格式解析，
 * 以及 custom_llm_provider 覆盖。
 */
import { LlmProviders } from "../types/provider";
import type { ProviderConfig } from "../types/provider";
import { AnthropicProvider } from "./AnthropicProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { GLMProvider } from "./GLMProvider";
import { LLMuxProvider } from "./LLMuxProvider";
import { MiMoProvider } from "./MiMoProvider";
import { MiMoOpenAIProvider } from "./MiMoOpenAIProvider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/** 默认 API Base 映射 */
const DEFAULT_API_BASES: { [key in LlmProviders]?: string } = {
	[LlmProviders.OpenAI]: "https://api.openai.com",
	[LlmProviders.Anthropic]: "https://api.anthropic.com",
	[LlmProviders.DeepSeek]: "https://api.deepseek.com/beta",
	[LlmProviders.GLM]: "https://api.z.ai/api/paas/v4",
	[LlmProviders.MiMo]: "https://token-plan-cn.xiaomimimo.com",
	// DIFF-CFG-MIMO-01: 国际 region 走 OpenAI 兼容路径
	[LlmProviders.MiMoGlobal]: "https://api.xiaomimimo.com/v1",
	[LlmProviders.LLMux]: "http://192.168.1.220:18182",
};

/**
 * DIFF-PR-REGISTRY-01: prefix → provider 映射表。
 * 顺序：Anthropic → DeepSeek → GLM → MiMo → OpenAI（与原 if/else 顺序一致）。
 * 每个 provider 关联多个前缀（"foo/" + "foo-" 两种形态）。
 */
const PREFIX_TO_PROVIDER: ReadonlyArray<{ prefixes: readonly string[]; provider: LlmProviders }> = [
	{ prefixes: ["claude-", "anthropic/"], provider: LlmProviders.Anthropic },
	{ prefixes: ["deepseek/", "deepseek-"], provider: LlmProviders.DeepSeek },
	{ prefixes: ["glm/", "glm-", "chatglm-"], provider: LlmProviders.GLM },
	{ prefixes: ["mimo/", "mimo-"], provider: LlmProviders.MiMo },
	{ prefixes: ["gpt/", "gpt-", "o1/", "o1-", "o3/", "o3-"], provider: LlmProviders.OpenAI },
];

/**
 * Provider Registry
 *
 * Provider 注册表/工厂，支持 "provider/model" 格式解析，
 * 以及 custom_llm_provider 覆盖。管理所有 LLM 提供商的注册和查找。
 */
export class ProviderRegistry {
	private _providers: Map<string, ProviderConfig> = new Map();

	/**
	 * 注册一个 Provider 实例
	 * @param name
	 * @param provider
	 */
	register(name: string, provider: ProviderConfig): void {
		this._providers.set(name, provider);
	}

	/**
	 * 根据模型名称获取对应的 Provider
	 * @param model - 完整模型名，格式 "provider/model" 或纯模型名
	 * @param customProvider - 可选的 provider 覆盖
	 * @param params
	 * @returns ProviderConfig 实例
	 * @throws Error 当找不到对应的 Provider 时
	 */
	getProvider(model: string, customProvider?: string, params?: Record<string, unknown>): ProviderConfig {
		const providerName = customProvider ?? this.parseProviderName(model);

		// 检查已注册实例
		const registered = this._providers.get(providerName);
		if (registered) {
			return registered;
		}

		// 动态创建
		const provider = this.createProvider(providerName, params);
		if (provider) {
			return provider;
		}

		throw new Error(
			`Unknown provider: "${providerName}". Available providers: ${Array.from(this._providers.keys()).join(", ") || `${LlmProviders.OpenAI}, ${LlmProviders.Anthropic}, ${LlmProviders.DeepSeek}, ${LlmProviders.GLM}, ${LlmProviders.MiMo}, ${LlmProviders.LLMux}`}`,
		);
	}

	/**
	 * 获取已注册的所有 provider 名称
	 */
	getRegisteredNames(): string[] {
		return Array.from(this._providers.keys());
	}

	/**
	 * 从模型名中解析 provider 名称
	 *
	 * DIFF-PR-REGISTRY-01: 改成 prefix map + 一次遍历，消除多分支 if/else 链。
	 * 优先级按数组顺序（与原实现一致）：
	 *   1. 显式 "provider/model" 形式 — 取 "/" 前缀
	 *   2. Anthropic 家族: claude-, anthropic/
	 *   3. DeepSeek 家族: deepseek/, deepseek-
	 *   4. GLM 家族: glm/, glm-, chatglm-
	 *   5. MiMo 家族: mimo/, mimo-（含 mimo-global / mimo-international → MiMoGlobal）
	 *   6. OpenAI 家族: gpt/, gpt-, o1/, o1-, o3/, o3-
	 *   7. 兜底: OpenAI
	 * @param model
	 */
	parseProviderName(model: string): string {
		const slashIndex = model.indexOf("/");
		if (slashIndex !== -1) {
			return model.slice(0, slashIndex);
		}
		const lower = model.toLowerCase();
		// DIFF-CFG-MIMO-01: mimo-global / mimo-international 走国际 region — 优先于普通 mimo
		if (lower.includes("mimo-global") || lower.includes("mimo-international")) {
			return LlmProviders.MiMoGlobal;
		}
		// 一次遍历所有 prefix → provider 映射，命中即返回
		for (const { prefixes, provider } of PREFIX_TO_PROVIDER) {
			for (const p of prefixes) {
				if (lower.startsWith(p)) {
					return provider;
				}
			}
		}
		return LlmProviders.OpenAI;
	}

	/**
	 * 动态创建 Provider 实例
	 * @param providerName
	 * @param params - Optional request params for detecting proxy-level headers
	 */
	createProvider(providerName: string, params?: Record<string, unknown>): ProviderConfig | null {
		// Proxy header detection: extract API key from proxy-level headers
		const headerObj = params?.["headers"] as Record<string, string> | undefined;
		const proxyApiKey = headerObj?.["x-litellm-api-key"] ?? headerObj?.["x-litellm-proxy-api-key"];
		if (proxyApiKey && params) {
			params["api_key"] = proxyApiKey;
		}
		// PY: support dynamic api_base from environment or params (transformation.py)
		const dynamicApiBase = params?.["api_base"] as string | undefined;
		switch (providerName) {
			case LlmProviders.OpenAI:
				return new OpenAICompatProvider("", dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.OpenAI]!);
			case LlmProviders.Anthropic:
				return new AnthropicProvider(dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.Anthropic]);
			case LlmProviders.DeepSeek:
				return new DeepSeekProvider("", dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.DeepSeek]!);
			case LlmProviders.GLM:
				// DIFF-CFG-ZAI-02: 修正 GLMProvider 构造参数顺序 — GLMProvider(apiKey, apiBase)，
				// 之前漏传 apiKey 让 dynamicApiBase 落到 apiKey 位置导致 base 失效。
				return new GLMProvider("", dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.GLM]);
			case LlmProviders.MiMo:
				return new MiMoProvider(dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.MiMo]);
			case LlmProviders.MiMoGlobal:
				// DIFF-CFG-MIMO-01: 国际 region 走 OpenAI 兼容路径
				return new MiMoOpenAIProvider("", dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.MiMoGlobal]!);
			case LlmProviders.LLMux:
				return new LLMuxProvider(dynamicApiBase ?? DEFAULT_API_BASES[LlmProviders.LLMux]);
			default:
				return null;
		}
	}
}

/** 默认单例 */
export const defaultProviderRegistry = new ProviderRegistry();
