import type { MessagePart, ParsedMessage, ParsedMessages, ToolCall } from "../support/PrettyMessagesModels";
import {
	asRecord,
	stringValue,
	parseToolArguments,
	pickField,
	valueToText,
	safeJsonStringify,
	parseContentBlock,
	generatedImagePart,
} from "./PrettyMessagesBlocksLogic";
import { PRETTY_FIELD_RULES } from "./PrettyMessagesFieldRules";
import { isMissingSpendLogBlockRef } from "./spendLogBlockRefs";
/**
 * 丢弃没有任何可见内容的思考分区。
 *
 * 上游有时只产出空白（实测 reasoning 文本是一个空格、reasoning_tokens 为 1）。这样的块
 * 如果照常渲染，页面会出现一个空白的「Reasoning」框，看起来像内容丢失。既然用户看不到
 * 任何东西，就不该为它生成分区。
 * @param parts - 解析后的内容分区
 */
export const withoutEmptyThinking = (parts: MessagePart[]): MessagePart[] =>
	parts.filter((part) => part.kind !== "thinking" || (part.text ?? "").trim().length > 0);

export const contentFromParts = (parts: MessagePart[]): string =>
	parts
		.map((part) => {
			if (part.kind === "text" || part.kind === "tool_result" || part.kind === "image" || part.kind === "refusal") {
				return part.text || "";
			}
			if (part.kind === "thinking") return `[Thinking]\n${part.text || ""}`.trim();
			if (part.kind === "redacted_thinking") return "[Redacted thinking]";
			if (part.kind === "unknown") {
				return `[Unknown block: ${part.sourceType || "unknown"}]\n${safeJsonStringify(part.data)}`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");

export const parseContent = (content: unknown): { content: string; parts?: MessagePart[]; toolCalls?: ToolCall[] } => {
	if (typeof content === "string") return { content, parts: [{ kind: "text", label: "Text", text: content }] };
	if (!Array.isArray(content)) {
		if (content === null || content === undefined) return { content: "" };
		const parsed = parseContentBlock(content);
		const parts = withoutEmptyThinking([parsed.part]);
		return {
			content: contentFromParts(parts),
			parts,
			toolCalls: parsed.toolCall ? [parsed.toolCall] : undefined,
		};
	}

	const parsed = content.map(parseContentBlock);
	const parts = withoutEmptyThinking(parsed.map((item) => item.part));
	const toolCalls = parsed.flatMap((item) => (item.toolCall ? [item.toolCall] : []));
	return {
		content: contentFromParts(parts),
		parts,
		toolCalls: toolCalls.length ? toolCalls : undefined,
	};
};

const parseToolCalls = (toolCalls: unknown): ToolCall[] | undefined => {
	if (!Array.isArray(toolCalls)) return undefined;
	return toolCalls.map((item) => {
		const toolCall = asRecord(item) ?? {};
		return {
			id: String(toolCall.id || toolCall.call_id || ""),
			name: String(asRecord(toolCall.function)?.name || toolCall.name || "unknown"),
			arguments: parseToolArguments(asRecord(toolCall.function)?.arguments ?? toolCall.arguments ?? toolCall.input),
		};
	});
};

const toolCallsToParts = (toolCalls: ToolCall[] | undefined, label = "Function call"): MessagePart[] =>
	(toolCalls || []).map((toolCall) => ({
		kind: "tool_call",
		label,
		id: toolCall.id,
		name: toolCall.name,
		data: toolCall.arguments,
	}));

const normalizeRole = (role: unknown): ParsedMessage["role"] => {
	if (role === "model") return "assistant";
	return role === "system" || role === "assistant" || role === "tool" ? role : "user";
};

/**
 * 缺块占位消息：保留它在数组中的位置，内容标记为不可用。
 *
 * 占位对象里没有 role，借用默认的 `user` 只为通过角色归一的类型约束；渲染层按
 * `missingBlockRef` 显示提示，不会显示这个角色标签。
 */
const missingBlockRefMessage = (): ParsedMessage => ({ role: "user", content: "", missingBlockRef: true });

const parseRequestMessage = (value: unknown): ParsedMessage => {
	if (isMissingSpendLogBlockRef(value)) return missingBlockRefMessage();
	const message = asRecord(value);
	const role = normalizeRole(message?.role);
	const parsed = parseContent(pickField(message, PRETTY_FIELD_RULES.messageContent) ?? "");
	const explicitToolCalls = parseToolCalls(message?.tool_calls);
	const toolCalls = [...(parsed.toolCalls || []), ...(explicitToolCalls || [])];
	let parts = [...(parsed.parts || []), ...toolCallsToParts(explicitToolCalls)];

	if (role === "tool" && !parts.some((part) => part.kind === "tool_result")) {
		parts = [
			{
				kind: "tool_result",
				label: "Tool result",
				id: stringValue(message?.tool_call_id),
				name: stringValue(message?.name),
				text: parsed.content,
				parts: parsed.parts,
			},
		];
	}

	return {
		role,
		content: parsed.content,
		toolCalls: toolCalls.length ? toolCalls : undefined,
		toolCallId: stringValue(message?.tool_call_id),
		parts: parts.length ? parts : undefined,
	};
};

const requestMessagesFrom = (request: unknown): ParsedMessage[] => {
	if (typeof request === "string") {
		return request.trim() ? [parseRequestMessage({ role: "user", content: request })] : [];
	}
	const body = asRecord(asRecord(request)?.body) || asRecord(request) || {};
	const messages = Array.isArray(body.messages)
		? body.messages
		: Array.isArray(asRecord(request)?.messages)
			? (asRecord(request)!.messages as unknown[])
			: null;
	const result: ParsedMessage[] = messages ? messages.map(parseRequestMessage) : [];

	const systemContent = body.system ?? body.instructions;
	if (systemContent !== undefined && !result.some((message) => message.role === "system")) {
		result.unshift(parseRequestMessage({ role: "system", content: systemContent }));
	}
	if (!messages && body.input !== undefined) {
		if (typeof body.input === "string") {
			result.push(parseRequestMessage({ role: "user", content: body.input }));
		} else if (Array.isArray(body.input)) {
			body.input.forEach((value: unknown) => {
				// Responses 的 input 数组元素本身就是消息条目，缺块占位也出现在这一层；
				// 放进 content 数组会被当成未知内容块并原样输出 JSON。
				if (isMissingSpendLogBlockRef(value)) {
					result.push(missingBlockRefMessage());
					return;
				}
				const item = asRecord(value);
				if (item?.type === "message" || item?.role) {
					result.push(parseRequestMessage({ role: item?.role || "user", content: item?.content ?? value }));
				} else {
					result.push(parseRequestMessage({ role: "user", content: [value] }));
				}
			});
		}
	}
	if (!messages && Array.isArray(body.contents)) {
		body.contents.forEach((item: unknown) =>
			result.push(parseRequestMessage({ role: asRecord(item)?.role, parts: asRecord(item)?.parts })),
		);
	}
	if (result.length === 0 && typeof body.prompt === "string") {
		result.push(parseRequestMessage({ role: "user", content: body.prompt }));
	}
	return result;
};

const responseFromParts = (parts: MessagePart[], role: unknown = "assistant"): ParsedMessage => {
	const toolCalls = parts
		.filter((part) => part.kind === "tool_call")
		.map((part) => ({
			id: part.id || "",
			name: part.name || "unknown",
			arguments: parseToolArguments(part.data),
		}));
	return {
		role: normalizeRole(role),
		content: contentFromParts(parts),
		toolCalls: toolCalls.length ? toolCalls : undefined,
		parts: parts.length ? parts : undefined,
	};
};

/**
 * 内置能力（web search / fetch 等）的响应不走 OpenAI choices，而是
 * { brief, results, executor } 这样的私有结构。Pretty 视图原先只认
 * choices / output / candidates，导致 Logs 详情里这类记录显示为空。
 * 这里把它们转成可读的 parts，使搜索结果与来源真正可见。
 * @param response - 已落库的 response 字段
 * @returns 解析后的 message；无法识别时返回 null
 */
const parseBuiltinCapabilityResponse = (response: unknown): ParsedMessage | null => {
	const record = asRecord(response);
	if (!record) {
		return null;
	}
	const brief = typeof record.brief === "string" ? record.brief : "";
	const executor = typeof record.executor === "string" ? record.executor : "";
	const results = Array.isArray(record.results) ? record.results : [];
	// fetch 的响应是 { url, brief, title, content, executor }，没有 results。
	const fetchedUrl = typeof record.url === "string" ? record.url : "";
	const fetchedTitle = typeof record.title === "string" ? record.title : "";
	const fetchedContent = typeof record.content === "string" ? record.content : "";
	if (!brief && results.length === 0 && !fetchedContent && !fetchedUrl) {
		return null;
	}

	const parts: MessagePart[] = [];
	if (brief) {
		parts.push({ kind: "text", label: "Result", sourceType: "builtin_capability", text: brief });
	}
	for (const item of results) {
		const entry = asRecord(item);
		if (!entry) {
			continue;
		}
		const title = typeof entry.title === "string" ? entry.title : "";
		const url = typeof entry.url === "string" ? entry.url : "";
		const siteName = typeof entry.siteName === "string" ? entry.siteName : "";
		const date = typeof entry.date === "string" ? entry.date.slice(0, 10) : "";
		const snippet = typeof entry.snippet === "string" ? entry.snippet : typeof entry.summary === "string" ? entry.summary : "";
		const meta = [siteName, date].filter((value) => value.length > 0).join(" · ");
		const lines = [title, url, meta, snippet].filter((value) => value.length > 0);
		if (lines.length === 0) {
			continue;
		}
		parts.push({
			kind: "web_search",
			label: "Source",
			sourceType: "builtin_capability",
			name: title || url,
			text: lines.join("\n"),
			data: entry,
		});
	}
	if (fetchedUrl || fetchedContent) {
		parts.push({
			kind: "web_search",
			label: "Fetched page",
			sourceType: "builtin_capability",
			name: fetchedTitle || fetchedUrl,
			text: [fetchedTitle, fetchedUrl, fetchedContent].filter((value) => value.length > 0).join("\n"),
			data: record,
		});
	}
	if (executor) {
		parts.push({ kind: "text", label: "Executor", sourceType: "builtin_capability", text: executor });
	}
	return parts.length > 0 ? responseFromParts(parts) : null;
};

/**
 * 只解析请求侧消息。
 *
 * 流式期间响应每 400ms 变一次，请求侧内容不变；拆出来后调用方可以用请求的引用做
 * memo，不必跟着响应重算整段对话。
 * @param request - 请求体或 messages 数组
 * @returns 解析后的请求消息
 */
export const parseRequestMessages = (request: unknown): ParsedMessage[] => requestMessagesFrom(request);

/**
 * 只解析响应侧消息。
 * @param response - 已落库的 response 字段
 * @returns 解析后的响应消息；无法识别时返回 null
 */
export const parseResponseMessage = (value: unknown): ParsedMessage | null => {
	const response = asRecord(value);
	let responseMessage: ParsedMessage | null = null;
	const generatedImageParts = Array.isArray(response?.data)
		? response.data
				.map((item: unknown) => generatedImagePart(item, response.output_format))
				.filter((part: MessagePart | null): part is MessagePart => part !== null)
		: [];
	const builtinCapabilityMessage = parseBuiltinCapabilityResponse(response);
	const choices = Array.isArray(response?.choices) ? response.choices : [];
	const responseMsg = asRecord(asRecord(choices[0])?.message);

	if (builtinCapabilityMessage) {
		responseMessage = builtinCapabilityMessage;
	} else if (responseMsg) {
		const parsed = parseContent(pickField(responseMsg, PRETTY_FIELD_RULES.messageContent) ?? "");
		const reasoning = pickField(responseMsg, PRETTY_FIELD_RULES.messageReasoning);
		const explicitToolCalls = parseToolCalls(responseMsg.tool_calls);
		const parts = [
			...(reasoning
				? [
						{
							kind: "thinking",
							label: "Reasoning",
							sourceType: "reasoning_content",
							text: valueToText(reasoning),
						} as MessagePart,
					]
				: []),
			...(parsed.parts || []),
			...toolCallsToParts(explicitToolCalls),
		];
		responseMessage = {
			role: normalizeRole(responseMsg.role || "assistant"),
			content: [reasoning ? `[Thinking]\n${valueToText(reasoning)}` : "", parsed.content].filter(Boolean).join("\n"),
			toolCalls:
				parsed.toolCalls?.length || explicitToolCalls?.length
					? [...(parsed.toolCalls || []), ...(explicitToolCalls || [])]
					: undefined,
			parts: parts.length ? parts : undefined,
		};
	} else if (response?.type === "message" && Array.isArray(response.content)) {
		const parsed = parseContent(response.content);
		responseMessage = {
			role: normalizeRole(response.role || "assistant"),
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			parts: parsed.parts,
		};
	} else if (Array.isArray(response?.output)) {
		const parts = withoutEmptyThinking(
			response.output.flatMap((item: unknown) => {
				if (asRecord(item)?.type === "message") return parseContent(asRecord(item)?.content || []).parts || [];
				return [parseContentBlock(item).part];
			}),
		);
		responseMessage = responseFromParts(parts);
	} else if (generatedImageParts.length) {
		responseMessage = responseFromParts(generatedImageParts);
	} else if (Array.isArray(response?.candidates) && asRecord(response.candidates[0])?.content) {
		const candidate = asRecord(asRecord(response.candidates[0])?.content) ?? {};
		const parsed = parseContent(candidate.parts || candidate.content || []);
		responseMessage = {
			role: normalizeRole(candidate.role || "assistant"),
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			parts: parsed.parts,
		};
	} else if (response?.content !== undefined) {
		const parsed = parseContent(response.content);
		responseMessage = {
			role: normalizeRole(response.role || "assistant"),
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			parts: parsed.parts,
		};
	}

	return responseMessage;
};

export const parseMessages = (request: unknown, response: unknown): ParsedMessages => ({
	requestMessages: parseRequestMessages(request),
	responseMessage: parseResponseMessage(response),
});
