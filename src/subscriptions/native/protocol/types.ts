/**
 * 协议转换公共类型。
 *
 * 入口可能是 chat、Anthropic Messages 或 OpenAI Responses；上游额外支持 Gemini。
 * 转换只在协议不一致时发生，同协议请求由桥接层原样透传。
 */

import type {
	SubscriptionInboundProtocol,
	SubscriptionWireProtocol,
} from "../types";
import { translateProtocolRequest } from "./request";
import { translateProtocolResponse } from "./response";
import { createProtocolStreamTranslator } from "./stream";

/** SSE 事件中的数据载荷；非 JSON 行（如 [DONE]）保留字符串。 */
export type ProtocolPayload = Record<string, unknown> | string;

/** 一条协议事件；event 对应 SSE 的 event: 字段。 */
export interface ProtocolEvent {
	/** SSE 事件名；chat 流通常没有。 */
	readonly event?: string;
	/** JSON 对象或原始字符串。 */
	readonly data: ProtocolPayload;
}

/** 有状态的流式转换器。 */
export interface ProtocolStreamTranslator {
	/**
	 * 输入一条上游事件，返回零到多条入口协议事件。
	 * @param event - 上游事件
	 */
	push(event: ProtocolEvent): ProtocolEvent[];
	/** 上游结束后冲刷终止事件。 */
	flush(): ProtocolEvent[];
}

/** 请求翻译选项。 */
export interface ProtocolTranslationOptions {
	/** 客户端请求的模型 ID。 */
	readonly model: string;
	/** 上游模型 ID。 */
	readonly upstreamModel: string;
}

/** 流式翻译选项。 */
export interface ProtocolStreamOptions extends ProtocolTranslationOptions {
	/** 是否在 chat 流末尾补 [DONE]。 */
	readonly includeDone?: boolean;
}

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
