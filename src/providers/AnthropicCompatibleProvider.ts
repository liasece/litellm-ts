/** 同时支持 OpenAI Chat Completions 与原生 Anthropic Messages 的兼容 Provider 基类。 */

import type { ProviderRequest } from "../types/provider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/**
 * 为官方同时提供 OpenAI / Anthropic 兼容端点的厂商构造 Anthropic 出口。
 *
 * OpenAI 请求继续复用 OpenAICompatProvider；Anthropic 请求直接透传到厂商的
 * `/anthropic/v1/messages`。`anthropic_api_base` 被视为完整 Anthropic 根地址，
 * 便于指向已经在根路径暴露 `/v1/messages` 的私有代理。
 */
export class AnthropicCompatibleProvider extends OpenAICompatProvider {
	/**
	 * 构造原生 Anthropic Messages 请求。
	 * @param model
	 * @param optionalParams
	 */
	transformAnthropicRequest(model: string, optionalParams: Record<string, unknown>): ProviderRequest {
		const explicitAnthropicBase = optionalParams["anthropic_api_base"];
		const hasExplicitAnthropicBase = typeof explicitAnthropicBase === "string" && explicitAnthropicBase.length > 0;
		const configuredBase = hasExplicitAnthropicBase ? explicitAnthropicBase : (optionalParams["api_base"] ?? this.apiBase);
		const base = String(configuredBase)
			.replace(/\/+$/, "")
			.replace(/\/v1\/messages$/, "")
			.replace(/\/chat\/completions$/, "")
			.replace(/\/(?:beta|v1)$/, "");
		const anthropicBase = hasExplicitAnthropicBase || base.endsWith("/anthropic") ? base : `${base}/anthropic`;
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
