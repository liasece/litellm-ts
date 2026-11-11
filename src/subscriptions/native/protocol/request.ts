/**
 * 请求翻译入口：入口协议请求体 → 规范化请求 → 上游协议请求体。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import type { CanonicalRequest } from "./ir";
import type { ProtocolTranslationOptions } from "./types";
import { decodeChatRequest, encodeChatRequest } from "./convert/chat";
import { decodeGeminiRequest, encodeGeminiRequest } from "./convert/gemini";
import { decodeMessagesRequest, encodeMessagesRequest } from "./convert/messages";
import { decodeResponsesRequest, encodeResponsesRequest } from "./convert/responses";

/**
 * 把请求体解码为规范请求。
 * @param body - 入口请求体
 * @param inbound - 入口协议
 * @param model - 请求体缺少 model 时的回退值
 */
function decodeRequest(
	body: Record<string, unknown>,
	inbound: SubscriptionInboundProtocol,
	model: string,
): CanonicalRequest {
	switch (inbound) {
		case "messages":
			return decodeMessagesRequest(body, model);
		case "responses":
			return decodeResponsesRequest(body, model);
		case "gemini":
			return decodeGeminiRequest(body, model);
		default:
			return decodeChatRequest(body, model);
	}
}

/**
 * 把规范请求编码为目标协议请求体。
 * @param request - 规范请求
 * @param upstream - 目标协议
 * @param upstreamModel - 上游模型 ID
 */
function encodeRequest(
	request: CanonicalRequest,
	upstream: SubscriptionWireProtocol,
	upstreamModel: string,
): Record<string, unknown> {
	switch (upstream) {
		case "messages":
			return encodeMessagesRequest(request, upstreamModel);
		case "responses":
			return encodeResponsesRequest(request, upstreamModel);
		case "gemini":
			return encodeGeminiRequest(request, upstreamModel);
		default:
			return encodeChatRequest(request, upstreamModel);
	}
}

/**
 * 翻译请求；同协议保留未知字段，只替换模型。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 入口请求体
 * @param options - 模型映射
 */
export function translateProtocolRequest(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
	options: ProtocolTranslationOptions,
): Record<string, unknown> {
	if (inbound === upstream) {
		return { ...body, model: options.upstreamModel };
	}
	return encodeRequest(decodeRequest(body, inbound, options.model), upstream, options.upstreamModel);
}
