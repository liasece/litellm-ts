/**
 * 流式翻译入口：上游协议 SSE 事件 → 规范化流事件 → 入口协议 SSE 事件。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import type {
	CanonicalStreamDecoder,
	CanonicalStreamEncoder,
} from "./ir";
import type { ProtocolEvent, ProtocolStreamOptions, ProtocolStreamTranslator } from "./types";
import { createChatStreamDecoder, createChatStreamEncoder } from "./convert/chat";
import { createGeminiStreamDecoder, createGeminiStreamEncoder } from "./convert/gemini";
import { createMessagesStreamDecoder, createMessagesStreamEncoder } from "./convert/messages";
import { createResponsesStreamDecoder, createResponsesStreamEncoder } from "./convert/responses";

/**
 * 按上游协议创建流解码器。
 * @param protocol - 上游协议
 * @param options - 流式选项
 */
function createDecoder(protocol: SubscriptionWireProtocol, options: ProtocolStreamOptions): CanonicalStreamDecoder {
	switch (protocol) {
		case "messages":
			return createMessagesStreamDecoder(options);
		case "responses":
			return createResponsesStreamDecoder(options);
		case "gemini":
			return createGeminiStreamDecoder(options);
		default:
			return createChatStreamDecoder(options);
	}
}

/**
 * 按入口协议创建流编码器。
 * @param protocol - 入口协议
 * @param options - 流式选项
 */
function createEncoder(protocol: SubscriptionInboundProtocol, options: ProtocolStreamOptions): CanonicalStreamEncoder {
	switch (protocol) {
		case "messages":
			return createMessagesStreamEncoder(options);
		case "responses":
			return createResponsesStreamEncoder(options);
		case "gemini":
			return createGeminiStreamEncoder(options);
		default:
			return createChatStreamEncoder(options);
	}
}

/**
 * 创建协议流式翻译器。
 *
 * 同协议时保持原样透传；跨协议时先解码为规范事件，再编码成入口协议事件。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param options - 模型映射与终止帧选项
 */
export function createProtocolStreamTranslator(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	options: ProtocolStreamOptions,
): ProtocolStreamTranslator {
	if (inbound === upstream) {
		return {
			push: (event: ProtocolEvent): ProtocolEvent[] => [event],
			flush: (): ProtocolEvent[] => [],
		};
	}
	const decoder = createDecoder(upstream, options);
	const encoder = createEncoder(inbound, options);
	return {
		push: (event: ProtocolEvent): ProtocolEvent[] => {
			if (typeof event.data === "string") {
				return [];
			}
			const outgoing: ProtocolEvent[] = [];
			for (const canonical of decoder.decode(event)) {
				outgoing.push(...encoder.encode(canonical));
			}
			return outgoing;
		},
		flush: (): ProtocolEvent[] => encoder.flush(),
	};
}
