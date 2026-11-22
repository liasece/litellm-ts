/**
 * 协议翻译门面：把「入口协议 + 上游协议」派发到对应的具体转换器。
 *
 * 这三个函数原先放在 `protocol/types.ts` 里，而 `request.ts` / `response.ts` / `stream.ts`
 * 又反过来 import 它的类型，于是形成 `types → request → convert → types` 的环。把门面单独成
 * 文件后，`types.ts` 只留类型，转换器对它的依赖变成单向。
 */
import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import { translateProtocolRequest } from "./request";
import { translateProtocolResponse } from "./response";
import { createProtocolStreamTranslator } from "./stream";
import type { ProtocolStreamOptions, ProtocolStreamTranslator, ProtocolTranslationOptions } from "./types";

/**
 * 把入口协议请求体翻译成上游协议请求体。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 入口请求体
 * @param options - 模型映射
 */
export function translateRequest(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
	options: ProtocolTranslationOptions,
): Record<string, unknown> {
	return translateProtocolRequest(inbound, upstream, body, options);
}

/**
 * 把上游非流式响应翻译回入口协议。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 上游响应体
 * @param options - 模型映射
 */
export function translateResponse(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
	options: ProtocolTranslationOptions,
): Record<string, unknown> {
	return translateProtocolResponse(inbound, upstream, body, options);
}

/**
 * 创建有状态的流式转换器。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param options - 模型映射与终止帧选项
 */
export function createStreamTranslator(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	options: ProtocolStreamOptions,
): ProtocolStreamTranslator {
	return createProtocolStreamTranslator(inbound, upstream, options);
}
