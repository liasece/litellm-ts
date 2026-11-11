/**
 * 协议转换共用工具。
 *
 * 这里只放与具体协议无关的读值、ID、用量和结束原因归一化逻辑；各协议的
 * 字段形状由对应的 convert 模块负责。
 */

import { randomUUID } from "node:crypto";
import type {
	CanonicalCacheControl,
	CanonicalContentPart,
	CanonicalFinishReason,
	CanonicalUsage,
} from "../ir";

/**
 * 读取对象；数组、null 与原始值返回 undefined。
 * @param value - 任意值
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * 读取对象数组中的对象元素。
 * @param value - 待读取值
 */
export function asRecordArray(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const result: Record<string, unknown>[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (record !== undefined) {
			result.push(record);
		}
	}
	return result;
}

/**
 * 按候选键读取字符串。
 * @param record - 源对象
 * @param keys - 候选键
 */
export function stringAt(record: Record<string, unknown> | undefined, ...keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "string") {
			return value;
		}
	}
	return undefined;
}

/**
 * 按候选键读取数字。
 * @param record - 源对象
 * @param keys - 候选键
 */
export function numberAt(record: Record<string, unknown> | undefined, ...keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

/**
 * 按候选键读取布尔值。
 * @param record - 源对象
 * @param keys - 候选键
 */
export function booleanAt(record: Record<string, unknown> | undefined, ...keys: readonly string[]): boolean | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "boolean") {
			return value;
		}
	}
	return undefined;
}

/**
 * 按候选键读取对象。
 * @param record - 源对象
 * @param keys - 候选键
 */
export function recordAt(
	record: Record<string, unknown> | undefined,
	...keys: readonly string[]
): Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = asRecord(record?.[key]);
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

/**
 * 按候选键读取数组。
 * @param record - 源对象
 * @param keys - 候选键
 */
export function arrayAt(record: Record<string, unknown> | undefined, ...keys: readonly string[]): unknown[] | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (Array.isArray(value)) {
			return value;
		}
	}
	return undefined;
}

/**
 * 生成带前缀的 ID。
 * @param prefix - 前缀，如 msg
 */
export function generateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/**
 * 判断是否为非空字符串。
 * @param value - 任意值
 */
export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 把普通字符串或 data URL 解析为媒体类型与裸数据。
 * @param url - 原始 URL
 */
export function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
	if (!url.startsWith("data:")) {
		return undefined;
	}
	const comma = url.indexOf(",");
	if (comma < 0) {
		return undefined;
	}
	const header = url.slice(5, comma);
	const data = url.slice(comma + 1);
	const base64 = header.endsWith(";base64");
	const mediaType = (base64 ? header.slice(0, -7) : header).split(";")[0] ?? "";
	if (!mediaType || !data) {
		return undefined;
	}
	return { mediaType: mediaType, data: data };
}

/**
 * 把 data URL 拆成内联数据；非 data URL 返回 undefined。
 * @param url - 图片/文件地址
 */
export function inlineDataOf(url: string): { mimeType: string; data: string } | undefined {
	const parsed = parseDataUrl(url);
	if (!parsed) {
		return undefined;
	}
	return { mimeType: parsed.mediaType, data: parsed.data };
}

/**
 * 把工具参数归一化为 JSON 字符串。
 * @param value - 字符串或任意 JSON 值
 */
export function stringifyArguments(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === undefined || value === null) {
		return "{}";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}

/**
 * 把工具参数解析为对象；非对象或非法 JSON 返回空对象。
 * @param value - 参数 JSON 字符串
 */
export function parseArgumentsObject(value: string | undefined): Record<string, unknown> {
	if (!value || !value.trim()) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return asRecord(parsed) ?? {};
	} catch {
		return {};
	}
}

/**
 * 读取 cache_control 标记。
 * @param record - 含 cache_control 的对象
 */
export function cacheControlFrom(record: Record<string, unknown> | undefined): CanonicalCacheControl | undefined {
	const raw = asRecord(record?.["cache_control"]);
	if (!raw) {
		return undefined;
	}
	const type = stringAt(raw, "type");
	if (!type) {
		return undefined;
	}
	const ttl = stringAt(raw, "ttl");
	return ttl === undefined ? { type: type } : { type: type, ttl: ttl };
}

/**
 * 把 cache_control 序列化为上游字段。
 * @param cacheControl - 规范标记
 */
export function cacheControlTo(cacheControl: CanonicalCacheControl | undefined): Record<string, unknown> | undefined {
	if (!cacheControl) {
		return undefined;
	}
	return cacheControl.ttl === undefined
		? { type: cacheControl.type }
		: { type: cacheControl.type, ttl: cacheControl.ttl };
}

/**
 * 归一化停止序列字段。
 * @param value - 字符串或字符串数组
 */
export function normalizeStopList(value: unknown): string[] {
	if (typeof value === "string") {
		return value.length > 0 ? [value] : [];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	const stops: string[] = [];
	for (const item of value) {
		if (typeof item === "string" && item.length > 0) {
			stops.push(item);
		}
	}
	return stops;
}

/**
 * 合并相邻文本片段并丢弃空文本。
 * @param parts - 内容片段
 */
export function mergeAdjacentText(parts: readonly CanonicalContentPart[]): CanonicalContentPart[] {
	const merged: CanonicalContentPart[] = [];
	for (const part of parts) {
		const previous = merged.at(-1);
		if (part.type === "text" && previous?.type === "text") {
			const cacheControl = previous.cacheControl ?? part.cacheControl;
			merged[merged.length - 1] = {
				type: "text",
				text: previous.text + part.text,
				...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
			};
			continue;
		}
		if (part.type === "text" && part.text.length === 0) {
			continue;
		}
		merged.push(part);
	}
	return merged;
}

/**
 * 提取文本片段拼接结果。
 * @param parts - 内容片段
 */
export function partsToText(parts: readonly CanonicalContentPart[]): string {
	const texts: string[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			texts.push(part.text);
		}
	}
	return texts.join("");
}

/**
 * 按预算档位换算 Anthropic token 预算。
 * @param effort - 档位
 */
export function effortToBudget(effort: string): number | undefined {
	switch (effort.toLowerCase()) {
		case "minimal":
			return 1024;
		case "low":
			return 2048;
		case "medium":
			return 8192;
		case "high":
			return 16384;
		case "xhigh":
			return 24576;
		default:
			return undefined;
	}
}

/**
 * 按 token 预算换算归一化档位。
 * @param budget - token 预算
 */
export function budgetToEffort(budget: number): string {
	if (budget <= 1024) {
		return "minimal";
	}
	if (budget <= 2048) {
		return "low";
	}
	if (budget <= 8192) {
		return "medium";
	}
	return "high";
}

/**
 * Chat 结束原因转规范原因。
 * @param reason - Chat finish_reason
 */
export function finishFromChat(reason: string | undefined): CanonicalFinishReason {
	switch (reason) {
		case "length":
			return "length";
		case "tool_calls":
		case "function_call":
			return "tool_calls";
		case "content_filter":
			return "content_filter";
		default:
			return "stop";
	}
}

/**
 * 规范结束原因转 Chat 结束原因。
 * @param reason - 规范原因
 * @param hasToolCalls - 是否带工具调用
 */
export function finishToChat(reason: CanonicalFinishReason, hasToolCalls: boolean): string {
	if (hasToolCalls && reason !== "length" && reason !== "content_filter") {
		return "tool_calls";
	}
	switch (reason) {
		case "length":
			return "length";
		case "tool_calls":
			return "tool_calls";
		case "content_filter":
			return "content_filter";
		default:
			return "stop";
	}
}

/**
 * Anthropic stop_reason 转规范原因。
 * @param reason - stop_reason
 */
export function finishFromAnthropic(reason: string | undefined): CanonicalFinishReason {
	switch (reason) {
		case "max_tokens":
		case "model_context_window_exceeded":
			return "length";
		case "tool_use":
			return "tool_calls";
		case "refusal":
		case "sensitive":
			return "content_filter";
		default:
			return "stop";
	}
}

/**
 * 规范结束原因转 Anthropic stop_reason。
 * @param reason - 规范原因
 * @param hasToolCalls - 是否带工具调用
 */
export function finishToAnthropic(reason: CanonicalFinishReason, hasToolCalls: boolean): string {
	if (hasToolCalls && reason !== "length" && reason !== "content_filter") {
		return "tool_use";
	}
	switch (reason) {
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		case "content_filter":
			return "refusal";
		default:
			return "end_turn";
	}
}

/**
 * Gemini finishReason 转规范原因。
 * @param reason - Gemini finishReason
 */
export function finishFromGemini(reason: string | undefined): CanonicalFinishReason {
	switch (reason) {
		case "MAX_TOKENS":
			return "length";
		case "SAFETY":
		case "RECITATION":
		case "BLOCKLIST":
		case "PROHIBITED_CONTENT":
		case "SPII":
			return "content_filter";
		default:
			return "stop";
	}
}

/**
 * 组装规范用量并补全总数。
 * @param inputTokens - 输入 token
 * @param outputTokens - 输出 token
 * @param totalTokens - 上游给出的总数
 * @param cachedTokens - 缓存命中
 * @param cacheCreationTokens - 缓存写入
 * @param reasoningTokens - 思考 token
 */
export function buildUsage(
	inputTokens: number,
	outputTokens: number,
	totalTokens: number | undefined,
	cachedTokens: number | undefined,
	cacheCreationTokens: number | undefined,
	reasoningTokens: number | undefined,
): CanonicalUsage {
	return {
		inputTokens: inputTokens,
		outputTokens: outputTokens,
		totalTokens: totalTokens ?? inputTokens + outputTokens,
		...(cachedTokens === undefined ? {} : { cachedTokens: cachedTokens }),
		...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens: cacheCreationTokens }),
		...(reasoningTokens === undefined ? {} : { reasoningTokens: reasoningTokens }),
	};
}

/**
 * 合并用量，字段取较大值；用于流式分片补全。
 * @param current - 已累计用量
 * @param next - 新到用量
 */
export function mergeUsage(current: CanonicalUsage | undefined, next: CanonicalUsage): CanonicalUsage {
	if (!current) {
		return next;
	}
	const inputTokens = Math.max(current.inputTokens, next.inputTokens);
	const outputTokens = Math.max(current.outputTokens, next.outputTokens);
	return {
		inputTokens: inputTokens,
		outputTokens: outputTokens,
		totalTokens: Math.max(current.totalTokens, next.totalTokens, inputTokens + outputTokens),
		...(current.cachedTokens === undefined && next.cachedTokens === undefined
			? {}
			: { cachedTokens: Math.max(current.cachedTokens ?? 0, next.cachedTokens ?? 0) }),
		...(current.cacheCreationTokens === undefined && next.cacheCreationTokens === undefined
			? {}
			: { cacheCreationTokens: Math.max(current.cacheCreationTokens ?? 0, next.cacheCreationTokens ?? 0) }),
		...(current.reasoningTokens === undefined && next.reasoningTokens === undefined
			? {}
			: { reasoningTokens: Math.max(current.reasoningTokens ?? 0, next.reasoningTokens ?? 0) }),
	};
}

/**
 * 从 Chat usage 归一化 token 用量。
 * @param usage - usage 对象
 */
export function usageFromChat(usage: Record<string, unknown> | undefined): CanonicalUsage {
	const promptDetails = recordAt(usage, "prompt_tokens_details", "input_tokens_details");
	const completionDetails = recordAt(usage, "completion_tokens_details", "output_tokens_details");
	const input = numberAt(usage, "prompt_tokens", "input_tokens") ?? 0;
	const output = numberAt(usage, "completion_tokens", "output_tokens") ?? 0;
	const cachedTokens = numberAt(promptDetails, "cached_tokens") ?? numberAt(usage, "cache_read_input_tokens");
	const cacheCreationTokens =
		numberAt(promptDetails, "cache_creation_tokens", "cache_write_tokens") ??
		numberAt(usage, "cache_creation_input_tokens");
	const reasoningTokens = numberAt(completionDetails, "reasoning_tokens") ?? numberAt(usage, "reasoning_tokens");
	return buildUsage(input, output, numberAt(usage, "total_tokens"), cachedTokens, cacheCreationTokens, reasoningTokens);
}

/**
 * 从 Anthropic usage 归一化 token 用量。
 * @param usage - usage 对象
 */
export function usageFromAnthropic(usage: Record<string, unknown> | undefined): CanonicalUsage {
	const input = numberAt(usage, "input_tokens") ?? 0;
	const output = numberAt(usage, "output_tokens") ?? 0;
	const cachedTokens = numberAt(usage, "cache_read_input_tokens");
	const cacheCreationTokens = numberAt(usage, "cache_creation_input_tokens");
	return buildUsage(
		input + (cachedTokens ?? 0) + (cacheCreationTokens ?? 0),
		output,
		undefined,
		cachedTokens,
		cacheCreationTokens,
		undefined,
	);
}

/**
 * 从 Responses usage 归一化 token 用量。
 * @param usage - usage 对象
 */
export function usageFromResponses(usage: Record<string, unknown> | undefined): CanonicalUsage {
	const inputDetails = recordAt(usage, "input_tokens_details", "prompt_tokens_details");
	const outputDetails = recordAt(usage, "output_tokens_details", "completion_tokens_details");
	const input = numberAt(usage, "input_tokens", "prompt_tokens") ?? 0;
	const output = numberAt(usage, "output_tokens", "completion_tokens") ?? 0;
	return buildUsage(
		input,
		output,
		numberAt(usage, "total_tokens"),
		numberAt(inputDetails, "cached_tokens"),
		numberAt(inputDetails, "cache_creation_tokens"),
		numberAt(outputDetails, "reasoning_tokens"),
	);
}

/**
 * 从 Gemini usageMetadata 归一化 token 用量。
 * @param usage - usageMetadata 对象
 */
export function usageFromGemini(usage: Record<string, unknown> | undefined): CanonicalUsage {
	const input = numberAt(usage, "promptTokenCount") ?? 0;
	const thoughts = numberAt(usage, "thoughtsTokenCount");
	const output = (numberAt(usage, "candidatesTokenCount") ?? 0) + (thoughts ?? 0);
	return buildUsage(
		input,
		output,
		numberAt(usage, "totalTokenCount"),
		numberAt(usage, "cachedContentTokenCount"),
		numberAt(usage, "cacheCreationTokenCount"),
		thoughts,
	);
}

/**
 * 规范用量转 Chat usage。
 * @param usage - 规范用量
 */
export function chatUsage(usage: CanonicalUsage): Record<string, unknown> {
	return {
		prompt_tokens: usage.inputTokens,
		completion_tokens: usage.outputTokens,
		total_tokens: usage.totalTokens,
		...(usage.cachedTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: usage.cachedTokens } }),
		...(usage.reasoningTokens === undefined
			? {}
			: { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }),
	};
}

/**
 * 规范用量转 Anthropic usage。
 * @param usage - 规范用量
 */
export function anthropicUsage(usage: CanonicalUsage): Record<string, unknown> {
	const cached = usage.cachedTokens ?? 0;
	const created = usage.cacheCreationTokens ?? 0;
	return {
		input_tokens: Math.max(0, usage.inputTokens - cached - created),
		output_tokens: usage.outputTokens,
		...(cached > 0 ? { cache_read_input_tokens: cached } : {}),
		...(created > 0 ? { cache_creation_input_tokens: created } : {}),
	};
}

/**
 * 规范用量转 Responses usage。
 * @param usage - 规范用量
 */
export function responsesUsage(usage: CanonicalUsage): Record<string, unknown> {
	return {
		input_tokens: usage.inputTokens,
		input_tokens_details: { cached_tokens: usage.cachedTokens ?? 0 },
		output_tokens: usage.outputTokens,
		output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
		total_tokens: usage.totalTokens,
	};
}

/**
 * 规范用量转 Gemini usageMetadata。
 * @param usage - 规范用量
 */
export function geminiUsage(usage: CanonicalUsage): Record<string, unknown> {
	return {
		promptTokenCount: usage.inputTokens,
		candidatesTokenCount: Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0)),
		totalTokenCount: usage.totalTokens,
		...(usage.cachedTokens === undefined ? {} : { cachedContentTokenCount: usage.cachedTokens }),
		...(usage.reasoningTokens === undefined ? {} : { thoughtsTokenCount: usage.reasoningTokens }),
	};
}

/**
 * 把任意响应 ID 归一化为 Anthropic 风格 ID。
 * @param id - 上游 ID
 */
export function toAnthropicId(id: string | undefined): string {
	if (id === undefined || id.length === 0) {
		return generateId("msg");
	}
	return id.startsWith("msg_") ? id : `msg_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * 把任意响应 ID 归一化为 Responses 风格 ID。
 * @param id - 上游 ID
 */
export function toResponsesId(id: string | undefined): string {
	if (id === undefined || id.length === 0) {
		return generateId("resp");
	}
	if (id.startsWith("resp_")) {
		return id;
	}
	const dash = id.indexOf("-");
	const suffix = dash >= 0 ? id.slice(dash + 1) : id;
	return `resp_${suffix.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * 把工具调用 ID 归一化为 Anthropic 可接受的字符集。
 * @param id - 原始 ID
 */
export function sanitizeToolId(id: string | undefined): string {
	if (id === undefined || id.length === 0) {
		return generateId("toolu");
	}
	const sanitized = id.replace(/[^A-Za-z0-9_-]/g, "_");
	return sanitized.length > 0 ? sanitized : generateId("toolu");
}

/**
 * 归一化思考文本来源。
 * @param message - 消息对象
 */
export function reasoningTextOf(message: Record<string, unknown> | undefined): string {
	if (!message) {
		return "";
	}
	const direct = stringAt(message, "reasoning_content", "reasoning", "thinking");
	if (direct !== undefined && direct.length > 0) {
		return direct;
	}
	const details = arrayAt(message, "reasoning_details");
	if (details) {
		const texts: string[] = [];
		for (const item of details) {
			const record = asRecord(item);
			const text = stringAt(record, "text", "content");
			if (text) {
				texts.push(text);
			}
		}
		if (texts.length > 0) {
			return texts.join("");
		}
	}
	return "";
}

/**
 * 汇总 thinking_blocks 数组里的思考文本。
 * @param value - thinking_blocks 值
 */
export function thinkingBlockTexts(value: unknown): string[] {
	const texts: string[] = [];
	for (const block of asRecordArray(value)) {
		const text = stringAt(block, "thinking", "text");
		if (text !== undefined && text.length > 0) {
			texts.push(text);
		}
	}
	return texts;
}

/**
 * 深拷贝 JSON 值；无法克隆时原样返回。
 * @template T - 值类型
 * @param value - 待克隆值
 * @returns 克隆结果
 */
export function cloneJson<T>(value: T): T {
	try {
		return structuredClone(value);
	} catch {
		return value;
	}
}

/**
 * 判断空内容（无文本、无工具调用、无附件）。
 * @param parts - 内容片段
 */
export function isEmptyContent(parts: readonly CanonicalContentPart[]): boolean {
	for (const part of parts) {
		switch (part.type) {
			case "text":
				if (part.text.trim().length > 0) {
					return false;
				}
				break;
			case "image":
			case "document":
			case "thinking":
			case "refusal":
			case "tool_call":
			case "tool_result":
				return false;
			default:
				break;
		}
	}
	return true;
}
