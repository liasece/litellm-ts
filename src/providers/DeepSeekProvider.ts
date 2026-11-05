/** DeepSeek Provider：按入站协议使用 DeepSeek 原生 OpenAI / Anthropic 接口。 */

import type { Message } from "../types/openai";
import type { ProviderRequest } from "../types/provider";
import { AnthropicCompatibleProvider } from "./AnthropicCompatibleProvider";
import { backfillDeepSeekResponsesReasoning } from "./deepseekResponsesHistory";

/**
 * 支持原生 Responses 出口的 DeepSeek 模型。
 *
 * 托管 \`web_search\` 工具只能通过 Responses 协议下发；Chat Completions 的
 * \`web_search_options\` 会被上游忽略，联网能力于是静默降级为「模型自称无法联网」。
 * 旧名 deepseek-v4-flash 继续接受，因为既有部署仍按该名配置。
 */
const DEEPSEEK_RESPONSES_MODELS = new Set(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]);

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
	 * 官方当前为 deepseek-flash 与 deepseek-v4-pro 开放 Responses（旧名
	 * deepseek-v4-flash 仍被接受，实际由 V4.1-Flash-1017 承接）；其他模型返回
	 * undefined，让 Router 在不离开原 fallback 链的前提下使用 Chat 兼容路径。
	 * @param model
	 * @param body
	 * @param optionalParams
	 */
	override transformResponsesRequest(
		model: string,
		body: Record<string, unknown>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest | undefined {
		const upstreamModel = this.stripProviderPrefix(model);
		if (!DEEPSEEK_RESPONSES_MODELS.has(upstreamModel)) {
			return undefined;
		}

		const apiBaseRaw = optionalParams["api_base"];
		const apiBase = typeof apiBaseRaw === "string" && apiBaseRaw.length > 0 ? apiBaseRaw : this.apiBase;
		const normalizedBase = apiBase.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|embeddings)$/, "");
		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this.apiKey;
		// 跨上游 fallback 到官方 /responses 时，历史里可能缺少思考回显；只在官方端点这一层补结构占位，
		// 其余情况下请求体字节不变（判定依据与实测见 deepseekResponsesHistory.ts）。
		const requestBody: Record<string, unknown> =
			optionalParams["disable_deepseek_responses_reasoning_backfill"] === true
				? { ...body, model: upstreamModel }
				: backfillDeepSeekResponsesReasoning({ ...body, model: upstreamModel });

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
