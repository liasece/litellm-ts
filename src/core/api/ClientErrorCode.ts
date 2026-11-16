/**
 * 客户端可见的错误分类：把任意异常归一成"下游能否据此判断可重试"的稳定错误码。
 *
 * 背景：流式响应一旦开始写出 SSE，HTTP 状态行已经发出 200，失败只能以协议内的
 * 错误帧收尾。此时下游唯一能用来区分"限流可重试"与"真正的服务端故障"的信息就是
 * 错误帧里的 code/type。历史实现各入口各自硬编码（Responses 恒 `server_error`、
 * chat 恒 `stream_error`、Anthropic 恒 `api_error`），上游 429 因此被压成不可重试的
 * 通用错误，客户端不会按预期退避重试。
 *
 * 本模块只负责分类，不改变 HTTP 状态行；非流式路径仍由 ErrorResponseMapper 决定状态码。
 */

import { mapToApiError } from "./ErrorResponseMapper";
import { ContextWindowExceededError } from "../../router/RouterErrors";

/** 一次错误的客户端可见分类。 */
export interface ClientErrorClassification {
	/** 等价的 HTTP 状态码，用于选择协议内的错误码取值。 */
	readonly status: number;
	/** OpenAI 系协议（chat SSE 的 code、Responses 的 error.code）使用的错误码。 */
	readonly code: string;
	/** chat SSE 错误的 type 字段；沿用 OpenAI error.type 的取值习惯。 */
	readonly openAiType: string;
	/** Anthropic Messages 协议的错误 type。 */
	readonly anthropicType: string;
}

/** 状态码到 Anthropic 错误类型的精确对应；未列出的按状态码区间归类。 */
const ANTHROPIC_TYPE_BY_STATUS: Readonly<Record<number, string>> = {
	401: "authentication_error",
	403: "permission_error",
	404: "not_found_error",
	413: "request_too_large",
	429: "rate_limit_error",
};

/** 状态码到 OpenAI 系错误码与 type 的精确对应；未列出的按状态码区间归类。 */
const OPENAI_ERROR_BY_STATUS: Readonly<Record<number, { code: string; type: string }>> = {
	401: { code: "authentication_error", type: "authentication_error" },
	403: { code: "permission_denied", type: "permission_denied" },
	404: { code: "not_found", type: "not_found" },
	408: { code: "timeout", type: "timeout" },
	413: { code: "request_too_large", type: "invalid_request_error" },
	429: { code: "rate_limit_exceeded", type: "rate_limit_error" },
};

/**
 * 按状态码区间归类 Anthropic 错误类型。
 * @param status - 等价 HTTP 状态码
 */
function anthropicTypeForStatus(status: number): string {
	const exact = ANTHROPIC_TYPE_BY_STATUS[status];
	if (exact !== undefined) {
		return exact;
	}
	if (status >= 500) {
		return "api_error";
	}
	if (status >= 400) {
		return "invalid_request_error";
	}
	return "api_error";
}

/**
 * 按状态码区间归类 OpenAI 系错误码与 type。
 * @param status - 等价 HTTP 状态码
 */
function openAiErrorForStatus(status: number): { code: string; type: string } {
	const exact = OPENAI_ERROR_BY_STATUS[status];
	if (exact !== undefined) {
		return exact;
	}
	if (status >= 500) {
		return { code: "server_error", type: "server_error" };
	}
	if (status >= 400) {
		return { code: "invalid_request_error", type: "invalid_request_error" };
	}
	return { code: "server_error", type: "server_error" };
}

/**
 * 把任意异常分类成客户端可见错误码。
 *
 * 状态码复用 ErrorResponseMapper 的统一映射（含 LitellmError 自带 status_code 优先），
 * 因此与同一次错误在非流式路径上的 HTTP 状态保持一致。
 * @param error - 流式或错误帧阶段捕获的异常
 */
export function classifyClientError(error: unknown): ClientErrorClassification {
	// 上下文超限是 400 的细分：下游据 context_length_exceeded 做截断重试，
	// 归成通用 invalid_request_error 会丢掉这个唯一可行动的信息。
	if (error instanceof ContextWindowExceededError) {
		return {
			status: 400,
			code: "context_length_exceeded",
			openAiType: "invalid_request_error",
			anthropicType: "invalid_request_error",
		};
	}
	const status = mapToApiError(error).statusCode;
	const openAi = openAiErrorForStatus(status);
	return { status: status, code: openAi.code, openAiType: openAi.type, anthropicType: anthropicTypeForStatus(status) };
}
