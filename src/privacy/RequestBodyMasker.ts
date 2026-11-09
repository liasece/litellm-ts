/**
 * 请求体脱敏适配。
 *
 * 只改「模型能看到的内容」字段：正文、工具描述、工具参数、结构化输入。
 * 工具 JSON Schema、图片 / 音频 / 文件块、模型名、采样参数一律不动——
 * 改动 schema 会让模型产出不符合契约的 JSON，改动媒体块会直接损坏请求。
 *
 * 带签名的 thinking 块保持原样：签名覆盖的是上游看到的字节，我们收到的
 * thinking 文本本来就是模型在上游写下的占位符，改动它只会让下一轮签名校验失败。
 */
import type { PrivacyContext } from "./PrivacyContext";

/** 请求所属协议 */
export type PrivacyProtocol = "chat" | "completions" | "anthropic" | "responses" | "embeddings" | "skip";

/**
 * 读取普通对象。
 * @param value - 待判断的值
 */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 从请求路径判断协议；无法判断的路径直接跳过，避免误改未知结构。
 * @param path - Express 请求路径
 */
export function detectPrivacyProtocol(path: string): PrivacyProtocol {
	const normalized = path.toLowerCase();
	if (normalized.includes("/messages/count_tokens")) {
		return "anthropic";
	}
	if (normalized.includes("/chat/completions")) {
		return "chat";
	}
	if (normalized.includes("/responses/compact")) {
		return "responses";
	}
	if (normalized.endsWith("/responses") || normalized.includes("/responses/")) {
		return "responses";
	}
	if (normalized.endsWith("/messages")) {
		return "anthropic";
	}
	if (normalized.endsWith("/completions")) {
		return "completions";
	}
	if (normalized.endsWith("/embeddings")) {
		return "embeddings";
	}
	return "skip";
}

/**
 * 脱敏 OpenAI Chat / Anthropic 共用的多模态内容数组。
 * @param parts - 内容块数组
 * @param context - 脱敏上下文
 */
function maskContentParts(parts: unknown[], context: PrivacyContext): void {
	for (const item of parts) {
		const part = asRecord(item);
		if (part === null) {
			continue;
		}
		const type = typeof part["type"] === "string" ? part["type"] : "";
		if (type === "text" || type === "input_text" || type === "output_text" || type === "summary_text" || type === "refusal") {
			if (typeof part["text"] === "string") {
				part["text"] = context.maskText(part["text"]);
			}
			continue;
		}
		if (type === "image_url" || type === "image" || type === "input_image" || type === "input_audio" || type === "audio") {
			continue;
		}
		if (type === "input_file" || type === "file" || type === "document" || type === "video") {
			continue;
		}
		if (type === "tool_use") {
			if (part["input"] !== undefined) {
				part["input"] = context.maskValue(part["input"]);
			}
			continue;
		}
		if (type === "tool_result") {
			maskToolResult(part, context);
			continue;
		}
		if (type === "thinking") {
			maskThinkingBlock(part, context);
			continue;
		}
		if (type === "redacted_thinking") {
			continue;
		}
		if (typeof part["text"] === "string") {
			part["text"] = context.maskText(part["text"]);
		}
	}
}

/**
 * tool_result 的 content 可以是字符串，也可以是内容块数组。
 * @param part - tool_result 块
 * @param context - 脱敏上下文
 */
function maskToolResult(part: Record<string, unknown>, context: PrivacyContext): void {
	const content = part["content"];
	if (typeof content === "string") {
		part["content"] = context.maskText(content);
		return;
	}
	if (Array.isArray(content)) {
		maskContentParts(content, context);
	}
}

/**
 * thinking 块：带 signature 的整块跳过（签名覆盖上游字节）。
 * @param part - thinking 块
 * @param context - 脱敏上下文
 */
function maskThinkingBlock(part: Record<string, unknown>, context: PrivacyContext): void {
	if (typeof part["signature"] === "string" && part["signature"].length > 0) {
		return;
	}
	if (typeof part["thinking"] === "string") {
		part["thinking"] = context.maskText(part["thinking"]);
	}
}

/**
 * 脱敏 Chat Completions 请求体。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskChatBody(body: Record<string, unknown>, context: PrivacyContext): void {
	const system = body["system"];
	if (typeof system === "string") {
		body["system"] = context.maskText(system);
	} else if (Array.isArray(system)) {
		maskContentParts(system, context);
	}
	const messages = body["messages"];
	if (Array.isArray(messages)) {
		for (const item of messages) {
			const message = asRecord(item);
			if (message === null) {
				continue;
			}
			const content = message["content"];
			if (typeof content === "string") {
				message["content"] = context.maskText(content);
			} else if (Array.isArray(content)) {
				maskContentParts(content, context);
			}
			const toolCalls = message["tool_calls"];
			if (Array.isArray(toolCalls)) {
				maskToolCalls(toolCalls, context);
			}
			const functionCall = asRecord(message["function_call"]);
			if (functionCall !== null && typeof functionCall["arguments"] === "string") {
				functionCall["arguments"] = context.maskJsonText(functionCall["arguments"]);
			}
		}
	}
	maskToolDescriptions(body, context);
}

/**
 * Chat 工具调用参数（JSON 字符串）。
 * @param toolCalls - tool_calls 数组
 * @param context - 脱敏上下文
 */
function maskToolCalls(toolCalls: unknown[], context: PrivacyContext): void {
	for (const item of toolCalls) {
		const call = asRecord(item);
		const fn = asRecord(call?.["function"]);
		if (fn === null) {
			continue;
		}
		if (typeof fn["arguments"] === "string") {
			fn["arguments"] = context.maskJsonText(fn["arguments"]);
		}
	}
}

/**
 * 工具描述（不是参数 schema）。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskToolDescriptions(body: Record<string, unknown>, context: PrivacyContext): void {
	const tools = body["tools"];
	if (Array.isArray(tools)) {
		for (const item of tools) {
			const tool = asRecord(item);
			if (tool === null) {
				continue;
			}
			const fn = asRecord(tool["function"]);
			const description = fn?.["description"];
			if (typeof description === "string") {
				fn!["description"] = context.maskText(description);
			}
			if (typeof tool["description"] === "string") {
				tool["description"] = context.maskText(tool["description"]);
			}
		}
	}
	const functions = body["functions"];
	if (Array.isArray(functions)) {
		for (const item of functions) {
			const fn = asRecord(item);
			if (fn !== null && typeof fn["description"] === "string") {
				fn["description"] = context.maskText(fn["description"]);
			}
		}
	}
}

/**
 * 脱敏 Anthropic Messages 请求体。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskAnthropicBody(body: Record<string, unknown>, context: PrivacyContext): void {
	const system = body["system"];
	if (typeof system === "string") {
		body["system"] = context.maskText(system);
	} else if (Array.isArray(system)) {
		maskContentParts(system, context);
	}
	const messages = body["messages"];
	if (Array.isArray(messages)) {
		for (const item of messages) {
			const message = asRecord(item);
			if (message === null) {
				continue;
			}
			const content = message["content"];
			if (typeof content === "string") {
				message["content"] = context.maskText(content);
			} else if (Array.isArray(content)) {
				maskContentParts(content, context);
			}
		}
	}
	maskToolDescriptions(body, context);
}

/**
 * 脱敏 Responses API 的输入项。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskResponsesBody(body: Record<string, unknown>, context: PrivacyContext): void {
	const instructions = body["instructions"];
	if (typeof instructions === "string") {
		body["instructions"] = context.maskText(instructions);
	} else if (Array.isArray(instructions)) {
		maskContentParts(instructions, context);
	}
	const input = body["input"];
	if (typeof input === "string") {
		body["input"] = context.maskText(input);
	} else if (Array.isArray(input)) {
		for (const item of input) {
			maskResponsesInputItem(item, context);
		}
	}
	maskToolDescriptions(body, context);
}

/**
 * 单个 Responses 输入项。
 * @param item - 输入项
 * @param context - 脱敏上下文
 */
function maskResponsesInputItem(item: unknown, context: PrivacyContext): void {
	const record = asRecord(item);
	if (record === null) {
		return;
	}
	const type = typeof record["type"] === "string" ? record["type"] : typeof record["role"] === "string" ? "message" : "";
	if (type === "function_call" || type === "custom_tool_call") {
		if (typeof record["arguments"] === "string") {
			record["arguments"] = context.maskJsonText(record["arguments"]);
		}
		if (typeof record["input"] === "string") {
			record["input"] = context.maskText(record["input"]);
		}
		return;
	}
	if (type === "function_call_output" || type === "custom_tool_call_output") {
		const output = record["output"];
		if (typeof output === "string") {
			record["output"] = context.maskText(output);
		} else if (Array.isArray(output)) {
			maskContentParts(output, context);
		}
		return;
	}
	if (type === "reasoning") {
		const summary = record["summary"];
		if (Array.isArray(summary)) {
			maskContentParts(summary, context);
		}
		return;
	}
	if (type === "item_reference" || type === "compaction") {
		return;
	}
	const content = record["content"];
	if (typeof content === "string") {
		record["content"] = context.maskText(content);
	} else if (Array.isArray(content)) {
		maskContentParts(content, context);
	}
	if (typeof record["text"] === "string") {
		record["text"] = context.maskText(record["text"]);
	}
}

/**
 * 脱敏文本补全请求体。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskCompletionsBody(body: Record<string, unknown>, context: PrivacyContext): void {
	const prompt = body["prompt"];
	if (typeof prompt === "string") {
		body["prompt"] = context.maskText(prompt);
		return;
	}
	if (!Array.isArray(prompt)) {
		return;
	}
	body["prompt"] = prompt.map((item) => {
		if (typeof item === "string") {
			return context.maskText(item);
		}
		if (Array.isArray(item)) {
			return item.map((token) => (typeof token === "string" ? context.maskText(token) : token));
		}
		return item;
	});
}

/**
 * 脱敏向量化请求体。
 * @param body - 请求体
 * @param context - 脱敏上下文
 */
function maskEmbeddingsBody(body: Record<string, unknown>, context: PrivacyContext): void {
	const input = body["input"];
	if (typeof input === "string") {
		body["input"] = context.maskText(input);
		return;
	}
	if (Array.isArray(input)) {
		body["input"] = input.map((item) => (typeof item === "string" ? context.maskText(item) : item));
	}
}

/**
 * 按协议脱敏请求体（就地修改）。
 * @param body - 已解析的请求体
 * @param context - 脱敏上下文
 * @param protocol - 协议
 */
export function maskRequestBody(body: Record<string, unknown>, context: PrivacyContext, protocol: PrivacyProtocol): void {
	switch (protocol) {
		case "chat":
			maskChatBody(body, context);
			return;
		case "anthropic":
			maskAnthropicBody(body, context);
			return;
		case "responses":
			maskResponsesBody(body, context);
			return;
		case "completions":
			maskCompletionsBody(body, context);
			return;
		case "embeddings":
			maskEmbeddingsBody(body, context);
			return;
		case "skip":
			return;
		default:
			return;
	}
}
