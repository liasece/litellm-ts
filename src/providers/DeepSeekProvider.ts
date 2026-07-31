/** DeepSeek Provider：按入站协议使用 DeepSeek 原生 OpenAI / Anthropic 接口。 */

import { OpenAICompatProvider } from "./OpenAICompatProvider";
import type { ProviderRequest } from "../types/provider";

/**
 * DeepSeek 提供商
 *
 * Chat Completions 请求由 OpenAICompatProvider 原样透传；
 * Anthropic Messages 请求由 transformAnthropicRequest 指向 DeepSeek 的原生
 * `/anthropic/v1/messages` 端点，消息体不在 provider 层跨协议转换。
 */
export class DeepSeekProvider extends OpenAICompatProvider {
	constructor(apiKey = "", apiBase = "https://api.deepseek.com") {
		super(apiKey, apiBase);
	}

	/**
	 * 构造 DeepSeek 原生 Anthropic Messages 出口。
	 *
	 * anthropic_api_base 可单独覆盖 Anthropic 出口；否则从 api_base 派生
	 * `${api_base}/anthropic`。若调用方已经提供以 /anthropic 结尾的地址，
	 * 则直接使用，避免重复追加。
	 * @param model
	 * @param optionalParams
	 */
	transformAnthropicRequest(model: string, optionalParams: Record<string, unknown>): ProviderRequest {
		const configuredBase = optionalParams["anthropic_api_base"] ?? optionalParams["api_base"] ?? this.apiBase;
		const base = String(configuredBase)
			.replace(/\/+$/, "")
			.replace(/\/v1\/messages$/, "")
			.replace(/\/chat\/completions$/, "")
			.replace(/\/(?:beta|v1)$/, "");
		const anthropicBase = base.endsWith("/anthropic") ? base : `${base}/anthropic`;
		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this.apiKey;
		const anthropicVersionRaw = optionalParams["anthropic_version"];
		const anthropicVersion =
			typeof anthropicVersionRaw === "string" && anthropicVersionRaw.length > 0 ? anthropicVersionRaw : "2023-06-01";
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			accept: "application/json",
			"anthropic-version": anthropicVersion,
		};
		if (apiKey) {
			headers["x-api-key"] = apiKey;
		}

		return {
			url: `${anthropicBase}/v1/messages`,
			method: "POST",
			headers: headers,
			body: {},
			model: this.stripProviderPrefix(model),
		};
	}
}
