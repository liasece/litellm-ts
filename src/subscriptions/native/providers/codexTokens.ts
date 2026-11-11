/**
 * Codex 的本地 count_tokens 实现。
 *
 * 对齐 CPA `codex_executor_tokens.go`：先把入口协议翻译成 Responses，再按
 * instructions、input、tools、text.format 的顺序收集有效文本，用对应模型的
 * tiktoken 编码计数。上游不提供单独的 token 计数端点，因此只能本地计算。
 */

import { encoding_for_model, get_encoding, type Tiktoken } from "tiktoken";

/** 编码缓存；tiktoken 初始化较慢。 */
const encoderCache = new Map<string, Tiktoken>();

/**
 * 选择模型的 tiktoken 编码。
 * @param model - 上游模型 ID
 */
export function codexEncoding(model: string): Tiktoken {
	const normalized = model.trim().toLowerCase();
	const key = normalized.startsWith("gpt-5")
		? "gpt-5"
		: normalized.startsWith("gpt-4.1")
			? "gpt-4.1"
			: normalized.startsWith("gpt-4o")
				? "gpt-4o"
				: normalized.startsWith("gpt-4")
					? "gpt-4"
					: normalized.startsWith("gpt-3.5") || normalized.startsWith("gpt-3")
						? "gpt-3.5-turbo"
						: "cl100k_base";
	const cached = encoderCache.get(key);
	if (cached) {
		return cached;
	}
	let encoder: Tiktoken;
	try {
		encoder = key === "cl100k_base" ? get_encoding("cl100k_base") : encoding_for_model(key);
	} catch {
		encoder = get_encoding("cl100k_base");
	}
	encoderCache.set(key, encoder);
	return encoder;
}

/**
 * 从 Responses 请求体收集参与计数的文本段。
 * @param body - Responses 请求体
 */
export function codexTokenSegments(body: Record<string, unknown>): string[] {
	const segments: string[] = [];
	const push = (value: unknown): void => {
		if (typeof value === "string" && value.trim()) {
			segments.push(value.trim());
		}
	};
	push(body["instructions"]);
	const input = body["input"];
	if (typeof input === "string") {
		push(input);
	} else if (Array.isArray(input)) {
		for (const raw of input) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
				continue;
			}
			const item = raw as Record<string, unknown>;
			const type = typeof item["type"] === "string" ? item["type"] : "message";
			if (type === "message") {
				const content = item["content"];
				if (Array.isArray(content)) {
					for (const part of content) {
						if (part && typeof part === "object") {
							push((part as Record<string, unknown>)["text"]);
						}
					}
				} else {
					push(content);
				}
				continue;
			}
			if (type === "function_call") {
				push(item["name"]);
				push(item["arguments"]);
				continue;
			}
			if (type === "function_call_output") {
				push(item["output"]);
				continue;
			}
			push(item["text"]);
		}
	}
	const tools = body["tools"];
	if (Array.isArray(tools)) {
		for (const raw of tools) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
				continue;
			}
			const tool = raw as Record<string, unknown>;
			push(tool["name"]);
			push(tool["description"]);
			const parameters = tool["parameters"];
			if (parameters !== undefined) {
				push(typeof parameters === "string" ? parameters : JSON.stringify(parameters));
			}
		}
	}
	const text = body["text"];
	if (text && typeof text === "object" && !Array.isArray(text)) {
		const format = (text as Record<string, unknown>)["format"];
		if (format && typeof format === "object" && !Array.isArray(format)) {
			const formatRecord = format as Record<string, unknown>;
			push(formatRecord["name"]);
			const schema = formatRecord["schema"];
			if (schema !== undefined) {
				push(typeof schema === "string" ? schema : JSON.stringify(schema));
			}
		}
	}
	return segments;
}

/**
 * 计算 Codex Responses 请求的输入 token 数。
 * @param body - Responses 请求体
 * @param model - 上游模型 ID
 */
export function countCodexTokens(body: Record<string, unknown>, model: string): number {
	const segments = codexTokenSegments(body);
	if (segments.length === 0) {
		return 0;
	}
	return codexEncoding(model).encode(segments.join("\n")).length;
}
