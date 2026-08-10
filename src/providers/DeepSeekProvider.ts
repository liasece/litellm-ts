/** DeepSeek Provider：按入站协议使用 DeepSeek 原生 OpenAI / Anthropic 接口。 */

import type { Message } from "../types/openai";
import type { ProviderRequest } from "../types/provider";
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

	/**
	 * DeepSeek 的 OpenAI 兼容 Chat Completions 当前不接受 `developer` role。
	 * 保持 OpenAI 请求协议与端点不变，只在该 provider 出口把等价指令角色降级为 `system`。
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const normalizedMessages = messages.map((message) => (message.role === "developer" ? { ...message, role: "system" } : message));
		const normalizedOptionalParams = { ...optionalParams };
		if (normalizedOptionalParams["tool_choice"] !== undefined && normalizedOptionalParams["tool_choice"] !== "auto") {
			// DeepSeek V4 thinking mode supports automatic tool calls but rejects
			// `required` and named tool_choice. Disable thinking for forced/disabled
			// choices so the OpenAI tool_choice contract remains usable.
			normalizedOptionalParams["thinking"] = { type: "disabled" };
			delete normalizedOptionalParams["reasoning_effort"];
		}
		return super.transformRequest(model, normalizedMessages, normalizedOptionalParams);
	}

	/**
	 * DeepSeek 原生 Responses 出口。
	 *
	 * 官方当前仅为 deepseek-v4-flash 开放 Responses；其他模型返回 undefined，
	 * 让 Router 在不离开原 fallback 链的前提下使用 Chat 兼容路径。
	 * @param model
	 * @param body
	 * @param optionalParams
	 */
	transformResponsesRequest(
		model: string,
		body: Record<string, unknown>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest | undefined {
		const upstreamModel = this.stripProviderPrefix(model);
		if (upstreamModel !== "deepseek-v4-flash") {
			return undefined;
		}

		const apiBaseRaw = optionalParams["api_base"];
		const apiBase = typeof apiBaseRaw === "string" && apiBaseRaw.length > 0 ? apiBaseRaw : this.apiBase;
		const normalizedBase = apiBase.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|embeddings)$/, "");
		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this.apiKey;
		const requestBody: Record<string, unknown> = { ...body, model: upstreamModel };

		return {
			url: `${normalizedBase}/responses`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: requestBody,
			model: model,
			stream: requestBody["stream"] === true,
			responseProtocol: "responses",
		};
	}
}
