/**
 * MiMo OpenAI Provider - 国际 region（OpenAI 兼容协议）
 *
 * 对齐 PY `litellm/llms/openai_like/providers.json:22-23`：
 *   xiaomi_mimo.base_url = "https://api.xiaomimimo.com/v1"
 *   base_class = "openai_gpt"
 *   param_mappings.max_completion_tokens -> max_tokens
 *
 * 因此该 provider 继承 OpenAICompatProvider 并重写 param mapping：
 *   - 默认 api_base: https://api.xiaomimimo.com/v1
 *   - 重映射 max_completion_tokens -> max_tokens（移除 max_completion_tokens）
 *
 * 用法：
 *   - 中国 region 部署：model = "mimo-v2.5-pro" → 走 MiMoProvider（Anthropic 协议）
 *   - 国际 region 部署：model = "mimo-global" 或 model = "mimo-international" → 走 MiMoOpenAIProvider
 */
import type { ProviderRequest } from "../types/provider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/**
 * MiMo 国际 region 提供商（OpenAI 兼容协议）
 */
export class MiMoOpenAIProvider extends OpenAICompatProvider {
	constructor(apiKey = "", apiBase = "https://api.xiaomimimo.com/v1") {
		super(apiKey, apiBase);
	}

	/**
	 * 对齐 PY param_mappings: max_completion_tokens -> max_tokens
	 * 透传前把 max_completion_tokens 改写为 max_tokens（MiMo 国际端点不支持 max_completion_tokens）
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	override transformRequest(
		model: string,
		messages: { role: string; content: string | null }[],
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const mapped: Record<string, unknown> = { ...optionalParams };
		if (typeof mapped["max_completion_tokens"] === "number") {
			const mct = mapped["max_completion_tokens"] as number;
			// max_tokens 优先；若调用方已显式设 max_tokens，则取较大者；否则直接覆盖
			if (typeof mapped["max_tokens"] !== "number") {
				mapped["max_tokens"] = mct;
			} else {
				mapped["max_tokens"] = Math.max(mapped["max_tokens"] as number, mct);
			}
			delete mapped["max_completion_tokens"];
		}
		// 与 GLMProvider 同步：deployment 上 litellm_params.api_key 优先
		const apiKey = (mapped["api_key"] as string | undefined) ?? this.apiKey;
		const prevApiKey = this.apiKey;
		if (apiKey) {
			this.apiKey = apiKey;
		}
		try {
			return super.transformRequest(model, messages, mapped);
		} finally {
			this.apiKey = prevApiKey;
		}
	}

	/**
	 * MiMo 标识符无需 provider 前缀剥离
	 * @param model
	 */
	override stripProviderPrefix(model: string): string {
		return model;
	}
}
