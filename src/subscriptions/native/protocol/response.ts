/**
 * 响应翻译入口：上游协议响应体 → 规范化响应 → 入口协议响应体。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import type { CanonicalResponse } from "./ir";
import type { ProtocolTranslationOptions } from "./types";
import { decodeChatResponse, encodeChatResponse } from "./convert/chat";
import { decodeGeminiResponse, encodeGeminiResponse } from "./convert/gemini";
import { decodeMessagesResponse, encodeMessagesResponse } from "./convert/messages";
import { decodeResponsesResponse, encodeResponsesResponse } from "./convert/responses";
import { asRecord, stringAt } from "./convert/shared";

/**
 * 把响应体解码为规范响应。
 * @param body - 上游响应体
 * @param upstream - 上游协议
 * @param model - 响应体缺少 model 时的回退值
 */
function decodeResponse(
	body: Record<string, unknown>,
	upstream: SubscriptionWireProtocol,
	model: string,
): CanonicalResponse {
	switch (upstream) {
		case "messages":
			return decodeMessagesResponse(body, model);
		case "responses":
			return decodeResponsesResponse(body, model);
		case "gemini":
			return decodeGeminiResponse(body, model);
		default:
			return decodeChatResponse(body, model);
	}
}

/**
 * 判断响应体是否为错误载荷。
 * @param body - 响应体
 */
function isErrorBody(body: Record<string, unknown>): boolean {
	if (stringAt(body, "type") === "error") {
		return true;
	}
	const error = body["error"];
	if (error === undefined || error === null) {
		return false;
	}
	return typeof error === "string" || asRecord(error) !== undefined;
}

/**
 * 提取错误信息。
 * @param body - 错误载荷
 */
function errorDetails(body: Record<string, unknown>): { message: string; type: string } {
	const record = asRecord(body["error"]) ?? body;
	return {
		message: stringAt(record, "message") ?? stringAt(body, "message") ?? "上游请求失败",
		type:
			stringAt(record, "type") ??
			stringAt(record, "status") ??
			stringAt(record, "code") ??
			"upstream_error",
	};
}

/**
 * 把 Google 风格的状态码归一到 Anthropic/OpenAI 的错误类型。
 * @param type - 上游错误类型
 */
function normalizeErrorType(type: string): string {
	switch (type.toUpperCase()) {
		case "RESOURCE_EXHAUSTED":
			return "rate_limit_error";
		case "UNAUTHENTICATED":
			return "authentication_error";
		case "PERMISSION_DENIED":
			return "permission_error";
		case "INVALID_ARGUMENT":
			return "invalid_request_error";
		case "NOT_FOUND":
			return "not_found_error";
		case "UNAVAILABLE":
			return "overloaded_error";
		case "INTERNAL":
		case "UNKNOWN":
			return "api_error";
		default:
			return type;
	}
}

/**
 * 把错误载荷翻译成入口协议的错误结构。
 * @param inbound - 入口协议
 * @param body - 错误载荷
 */
function translateError(inbound: SubscriptionInboundProtocol, body: Record<string, unknown>): Record<string, unknown> {
	const details = errorDetails(body);
	const errorType = normalizeErrorType(details.type);
	switch (inbound) {
		case "messages":
			return { type: "error", error: { type: errorType, message: details.message } };
		case "responses":
			return { error: { code: details.type, message: details.message, param: null } };
		default:
			return { error: { message: details.message, type: errorType, param: null, code: null } };
	}
}

/**
 * 把规范响应编码为入口协议响应体。
 * @param response - 规范响应
 * @param inbound - 入口协议
 * @param model - 对外模型 ID
 */
function encodeResponse(
	response: CanonicalResponse,
	inbound: SubscriptionInboundProtocol,
	model: string,
): Record<string, unknown> {
	switch (inbound) {
		case "messages":
			return encodeMessagesResponse(response, model);
		case "responses":
			return encodeResponsesResponse(response, model);
		case "gemini":
			return encodeGeminiResponse(response, model);
		default:
			return encodeChatResponse(response, model);
	}
}

/**
 * 翻译非流式响应；同协议保留未知字段，只替换模型。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 上游响应体
 * @param options - 模型映射
 */
export function translateProtocolResponse(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
	options: ProtocolTranslationOptions,
): Record<string, unknown> {
	if (inbound === upstream) {
		return { ...body, model: options.model };
	}
	if (isErrorBody(body)) {
		return translateError(inbound, body);
	}
	return encodeResponse(decodeResponse(body, upstream, options.upstreamModel), inbound, options.model);
}
