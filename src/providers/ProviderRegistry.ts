/**
 * Provider Registry
 *
 * Provider 注册表/工厂，支持 "provider/model" 格式解析，
 * 以及 custom_llm_provider 覆盖。
 */
import type { ProviderConfig } from "../types/provider";
import { AnthropicProvider } from "./AnthropicProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { GLMProvider } from "./GLMProvider";
import { LLMuxProvider } from "./LLMuxProvider";
import { MiMoProvider } from "./MiMoProvider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/** 默认 API Base 映射 */
const DEFAULT_API_BASES: Record<string, string> = {
	openai: "https://api.openai.com",
	anthropic: "https://api.anthropic.com",
	deepseek: "https://api.deepseek.com/beta",
	glm: "https://open.bigmodel.cn/api/paas/v4",
	mimo: "https://token-plan-cn.xiaomimimo.com",
	llmux: "http://192.168.1.220:18182",
};

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
			`Unknown provider: "${providerName}". Available providers: ${Array.from(this._providers.keys()).join(", ") || "openai, anthropic, deepseek, glm, mimo, llmux"}`,
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
	 * @param model
	 */
	parseProviderName(model: string): string {
		const slashIndex = model.indexOf("/");
		if (slashIndex !== -1) {
			return model.slice(0, slashIndex);
		}
		// 无 provider 前缀时，从模型名推断
		const lower = model.toLowerCase();
		if (lower.startsWith("claude-") || lower.startsWith("anthropic/")) {
			return "anthropic";
		}
		if (lower.startsWith("deepseek/") || lower.startsWith("deepseek-")) {
			return "deepseek";
		}
		if (lower.startsWith("glm/") || lower.startsWith("glm-") || lower.startsWith("chatglm-")) {
			return "glm";
		}
		if (lower.startsWith("mimo/") || lower.startsWith("mimo-")) {
			return "mimo";
		}
		if (
			lower.startsWith("gpt/") ||
			lower.startsWith("gpt-") ||
			lower.startsWith("o1/") ||
			lower.startsWith("o1-") ||
			lower.startsWith("o3/") ||
			lower.startsWith("o3-")
		) {
			return "openai";
		}
		return "openai";
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
			case "openai":
				return new OpenAICompatProvider("", dynamicApiBase ?? DEFAULT_API_BASES.openai!);
			case "anthropic":
				return new AnthropicProvider(dynamicApiBase ?? DEFAULT_API_BASES.anthropic);
			case "deepseek":
				return new DeepSeekProvider("", dynamicApiBase ?? DEFAULT_API_BASES.deepseek!);
			case "glm":
				return new GLMProvider(dynamicApiBase ?? DEFAULT_API_BASES.glm);
			case "mimo":
				return new MiMoProvider(dynamicApiBase ?? DEFAULT_API_BASES.mimo);
			case "llmux":
				return new LLMuxProvider(dynamicApiBase ?? DEFAULT_API_BASES.llmux);
			default:
				return null;
		}
	}
}

/** 默认单例 */
export const defaultProviderRegistry = new ProviderRegistry();
