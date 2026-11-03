import { collectTextSegments } from "../core/utils/contentFields";

/**
 * 流式 chunk 的「已经锁定候选模型」判定。
 *
 * 流式 fallback 只能在客户端还没收到**答案内容**时发生：一旦正文、拒绝文本或工具调用增量
 * 已经写出，再换模型重放就会在同一份响应里出现两段互相矛盾的助手输出。
 *
 * 但「已经产出过 chunk」不等于「已经给出答案」，下面几类都不算锁定：
 *
 * 1. 包络块：chat 协议的 `delta: {role: "assistant"}`、只带 `finish_reason` 或 usage 的
 *    收尾块，Responses 协议的 `response.created` / `response.in_progress` /
 *    `response.output_item.added`。它们对客户端没有信息量。
 * 2. 思考增量（reasoning_content / thinking / response.reasoning_text.*）：那是模型的中间
 *    过程，不是答复本身。换候选后客户端继续看到思考、再看到答案，仍是自洽的一份响应。
 * 3. 上游错误透传块：不是模型产出。
 *
 * 生产实测：request b28e4807（首个可见增量前被截断）与 request f2dd8cd7（思考增量之后被
 * 截断，只剩 `TypeError: terminated`）都因为判据过粗而放弃了 fallback，整条请求 503。
 */

/** Responses 协议里只承载包络、不含模型产出的语义事件。 */
const RESPONSES_ENVELOPE_EVENT_TYPES: ReadonlySet<string> = new Set([
	"response.created",
	"response.in_progress",
	"response.output_item.added",
	"response.content_part.added",
]);

/** Responses 协议终态事件：请求已经结束，不再有继续 fallback 的余地。 */
const RESPONSES_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
	"response.completed",
	"response.incomplete",
	"response.failed",
]);

/** Responses 协议里只承载思考过程的语义事件：不构成已下发的答案。 */
const RESPONSES_REASONING_EVENT_TYPES: ReadonlySet<string> = new Set([
	"response.reasoning_text.delta",
	"response.reasoning_text.done",
	"response.reasoning_summary_text.delta",
	"response.reasoning_summary_text.done",
	"response.reasoning_summary_part.added",
	"response.reasoning_summary_part.done",
]);

/**
 * 文本是否含可见字符（纯空白等同于空）。
 * @param value - 待判断的值
 */
function hasVisibleText(value: unknown): boolean {
	if (typeof value === "string") {
		return value.trim().length > 0;
	}
	if (Array.isArray(value)) {
		return collectTextSegments(value).some((segment) => segment.trim().length > 0);
	}
	return false;
}

/**
 * chat chunk 的 choices 是否已带出答案内容。
 *
 * content / refusal 有可见文本即算；工具调用增量也算，因为工具调用会下发给客户端，
 * 中途换模型会把它截成半截 JSON。思考字段刻意排除，见模块注释。
 * @param choices - chat chunk 的 choices 数组
 */
function choicesHaveAnswerOutput(choices: unknown[]): boolean {
	for (const choice of choices) {
		if (typeof choice !== "object" || choice === null) {
			continue;
		}
		const record = choice as Record<string, unknown>;
		const delta = record["delta"] ?? record["message"];
		if (typeof delta !== "object" || delta === null || Array.isArray(delta)) {
			continue;
		}
		const fields = delta as Record<string, unknown>;
		if (hasVisibleText(fields["content"]) || hasVisibleText(fields["refusal"])) {
			return true;
		}
		if (Array.isArray(fields["tool_calls"]) && fields["tool_calls"].length > 0) {
			return true;
		}
		if (typeof fields["function_call"] === "object" && fields["function_call"] !== null) {
			return true;
		}
	}
	return false;
}

/**
 * 原生 Responses 语义事件是否已带出答案内容。
 *
 * 包络、终态与思考事件排除；增量事件要求 payload 非空白（上游会发只含空白的增量）；
 * 其余未识别事件按「已锁定」处理——宁可放弃一次 fallback，也不重放看不懂的事件。
 * @param event - 单个 Responses 语义事件
 */
function responsesEventHasAnswerOutput(event: Record<string, unknown>): boolean {
	const type = typeof event["type"] === "string" ? event["type"] : "";
	if (RESPONSES_TERMINAL_EVENT_TYPES.has(type) || RESPONSES_ENVELOPE_EVENT_TYPES.has(type)) {
		return false;
	}
	if (RESPONSES_REASONING_EVENT_TYPES.has(type)) {
		return false;
	}
	// 思考 item 收尾只说明「想完了」，答案还没开始。
	if (type === "response.output_item.done") {
		const item = event["item"];
		if (typeof item === "object" && item !== null && (item as Record<string, unknown>)["type"] === "reasoning") {
			return false;
		}
		return true;
	}
	if (type.endsWith(".delta")) {
		return hasVisibleText(event["delta"]);
	}
	return true;
}

/**
 * 判断一个流式 chunk 是否已经锁定了当前候选模型（客户端已看到答案内容）。
 *
 * 返回 false 表示此刻切换候选不会让客户端看到互相矛盾的答复。
 * @param chunk - Router 流式链路上游产出的单个 chunk
 */
export function hasCommittedStreamOutput(chunk: unknown): boolean {
	if (chunk === null || chunk === undefined) {
		return false;
	}
	// provider 不支持流式时的兜底路径会一次性 yield 整段文本，它本身就是答案内容。
	if (typeof chunk === "string") {
		return chunk.trim().length > 0;
	}
	if (typeof chunk !== "object") {
		return false;
	}
	const record = chunk as Record<string, unknown>;
	if (record["error"] !== undefined && record["choices"] === undefined && record["type"] === undefined) {
		return false;
	}
	if (Array.isArray(record["choices"])) {
		return choicesHaveAnswerOutput(record["choices"]);
	}
	if (typeof record["type"] === "string") {
		return responsesEventHasAnswerOutput(record);
	}
	return false;
}
