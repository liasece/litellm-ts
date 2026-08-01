/** MiniMax Provider：按入站协议使用 MiniMax 官方 OpenAI / Anthropic 兼容接口。 */

import { AnthropicCompatibleProvider } from "./AnthropicCompatibleProvider";

/** MiniMax 提供商。中国区默认 OpenAI base 为 `/v1`，Anthropic 出口自动派生为 `/anthropic`。 */
export class MiniMaxProvider extends AnthropicCompatibleProvider {
	constructor(apiKey = "", apiBase = "https://api.minimaxi.com/v1") {
		super(apiKey, apiBase);
	}
}
