/** DeepSeek Provider：按入站协议使用 DeepSeek 原生 OpenAI / Anthropic 接口。 */

import { AnthropicCompatibleProvider } from "./AnthropicCompatibleProvider";

/**
 * DeepSeek 提供商
 *
 * Chat Completions 请求由 OpenAICompatProvider 原样透传；
 * Anthropic Messages 请求由 transformAnthropicRequest 指向 DeepSeek 的原生
 * `/anthropic/v1/messages` 端点，消息体不在 provider 层跨协议转换。
 */
export class DeepSeekProvider extends AnthropicCompatibleProvider {
	constructor(apiKey = "", apiBase = "https://api.deepseek.com") {
		super(apiKey, apiBase);
	}
}
