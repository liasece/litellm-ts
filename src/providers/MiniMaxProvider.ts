/** MiniMax Provider：按入站协议使用 MiniMax 官方 OpenAI / Anthropic 兼容接口。 */

import type { ProviderRequest } from "../types/provider";
import { AnthropicCompatibleProvider } from "./AnthropicCompatibleProvider";

/** MiniMax 提供商。中国区默认 OpenAI base 为 `/v1`，Anthropic 出口自动派生为 `/anthropic`。 */
export class MiniMaxProvider extends AnthropicCompatibleProvider {
	constructor(apiKey = "", apiBase = "https://api.minimaxi.com/v1") {
		super(apiKey, apiBase);
	}

	/**
	 * MiniMax 流式用量必须显式请求，供费用日志及 Responses 转换使用。
	 * 客户端是否接收 Chat usage chunk 仍由入口按原始请求决定。
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	override transformRequest(
		model: string,
		messages: { role: string; content: string | null }[],
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const request = super.transformRequest(model, messages, optionalParams);
		if (request.stream) {
			const body = request.body as Record<string, unknown>;
			const streamOptions = body["stream_options"];
			body["stream_options"] = {
				...(typeof streamOptions === "object" && streamOptions !== null && !Array.isArray(streamOptions) ? streamOptions : {}),
				include_usage: true,
			};
		}
		return request;
	}
}
