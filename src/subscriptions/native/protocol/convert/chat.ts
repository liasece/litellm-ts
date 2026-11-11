/**
 * OpenAI Chat Completions 协议的请求、响应与流式事件编解码。
 */

import type {
	CanonicalContentPart,
	CanonicalFinishReason,
	CanonicalMessage,
	CanonicalRequest,
	CanonicalRequestExtras,
	CanonicalResponse,
	CanonicalResponseFormat,
	CanonicalStreamDecoder,
	CanonicalStreamEncoder,
	CanonicalStreamEvent,
	CanonicalStreamOptions,
	CanonicalTool,
	CanonicalToolChoice,
	CanonicalUsage,
} from "../ir";
import type { ProtocolEvent } from "../types";
import {
	arrayAt,
	asRecord,
	asRecordArray,
	booleanAt,
	budgetToEffort,
	cacheControlFrom,
	cacheControlTo,
	chatUsage,
	finishFromChat,
	finishToChat,
	generateId,
	normalizeStopList,
	numberAt,
	reasoningTextOf,
	recordAt,
	stringAt,
	stringifyArguments,
	thinkingBlockTexts,
	usageFromChat,
} from "./shared";

/** Chat 请求中的消息数据结构。 */
interface ChatEncodedMessage {
	/** 角色。 */
	role: string;
	/** 内容。 */
	content: unknown;
	/** 工具调用。 */
	tool_calls?: Record<string, unknown>[];
	/** 工具消息对应的调用 ID。 */
	tool_call_id?: string;
	/** 思考文本。 */
	reasoning_content?: string;
	/** 拒答文本。 */
	refusal?: string;
	/** 消息级 cache_control。 */
	cache_control?: Record<string, unknown>;
}

/**
 * 解码 Chat 内容字段。
 * @param content - 消息内容
 */
function decodeChatContent(content: unknown): CanonicalContentPart[] {
	if (typeof content === "string") {
		return content.length === 0 ? [] : [{ type: "text", text: content }];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: CanonicalContentPart[] = [];
	for (const item of content) {
		if (typeof item === "string") {
			if (item.length > 0) {
				parts.push({ type: "text", text: item });
			}
			continue;
		}
		const part = asRecord(item);
		if (!part) {
			continue;
		}
		const type = stringAt(part, "type");
		switch (type) {
			case "text":
			case "input_text":
			case "output_text": {
				const text = stringAt(part, "text");
				if (text !== undefined && text.length > 0) {
					const cacheControl = cacheControlFrom(part);
					parts.push({
						type: "text",
						text: text,
						...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
					});
				}
				break;
			}
			case "image_url":
			case "image": {
				const imageUrl = part["image_url"];
				const imageRecord = asRecord(imageUrl);
				const url =
					typeof imageUrl === "string"
						? imageUrl
						: (stringAt(imageRecord, "url") ?? stringAt(part, "url"));
				if (url !== undefined && url.length > 0) {
					const detail = stringAt(imageRecord, "detail") ?? stringAt(part, "detail");
					const cacheControl = cacheControlFrom(part);
					parts.push({
						type: "image",
						url: url,
						...(detail === undefined ? {} : { detail: detail }),
						...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
					});
				}
				break;
			}
			case "file": {
				const file = recordAt(part, "file") ?? part;
				const data = stringAt(file, "file_data", "data");
				const fileId = stringAt(file, "file_id");
				const title = stringAt(file, "filename", "name");
				const mediaType = stringAt(file, "media_type", "mime_type");
				if (data !== undefined) {
					parts.push({
						type: "document",
						url: data,
						...(mediaType === undefined ? {} : { mediaType: mediaType }),
						...(title === undefined ? {} : { title: title }),
					});
				} else if (fileId !== undefined) {
					parts.push({
						type: "document",
						fileId: fileId,
						...(title === undefined ? {} : { title: title }),
					});
				}
				break;
			}
			case "refusal": {
				const text = stringAt(part, "refusal", "text");
				if (text !== undefined && text.length > 0) {
					parts.push({ type: "refusal", text: text });
				}
				break;
			}
			case "input_audio":
			case "audio":
				break;
			default: {
				const text = stringAt(part, "text");
				if (text !== undefined && text.length > 0) {
					parts.push({ type: "text", text: text });
				}
			}
		}
	}
	return parts;
}

/**
 * 解码助手消息里的工具调用。
 * @param value - tool_calls 字段
 */
export function decodeChatToolCalls(value: unknown): CanonicalContentPart[] {
	const parts: CanonicalContentPart[] = [];
	for (const raw of asRecordArray(value)) {
		const fn = recordAt(raw, "function");
		const name = stringAt(fn, "name");
		if (name === undefined || name.length === 0) {
			continue;
		}
		parts.push({
			type: "tool_call",
			id: stringAt(raw, "id") ?? generateId("call"),
			name: name,
			arguments: stringifyArguments(fn?.["arguments"]),
		});
	}
	return parts;
}

/**
 * 解码思考字段为 thinking 片段。
 * @param message - 消息对象
 */
function decodeChatReasoning(message: Record<string, unknown>): CanonicalContentPart[] {
	const parts: CanonicalContentPart[] = [];
	const reasoning = reasoningTextOf(message);
	if (reasoning.length > 0) {
		parts.push({ type: "thinking", text: reasoning });
	}
	for (const text of thinkingBlockTexts(message["thinking_blocks"])) {
		if (!parts.some((part) => part.type === "thinking" && part.text === text)) {
			parts.push({ type: "thinking", text: text });
		}
	}
	return parts;
}

/**
 * 解码 Chat 工具定义。
 * @param value - tools 字段
 */
export function decodeChatTools(value: unknown): CanonicalTool[] {
	const tools: CanonicalTool[] = [];
	for (const raw of asRecordArray(value)) {
		const type = stringAt(raw, "type");
		if (type !== undefined && type !== "function") {
			continue;
		}
		const fn = recordAt(raw, "function") ?? raw;
		const name = stringAt(fn, "name");
		if (name === undefined || name.length === 0) {
			continue;
		}
		const parameters = recordAt(fn, "parameters", "parametersJsonSchema", "input_schema");
		const description = stringAt(fn, "description");
		const strict = booleanAt(fn, "strict") ?? booleanAt(raw, "strict");
		const cacheControl = cacheControlFrom(raw) ?? cacheControlFrom(fn);
		tools.push({
			name: name,
			...(description === undefined ? {} : { description: description }),
			...(parameters === undefined ? {} : { parameters: parameters }),
			...(strict === undefined ? {} : { strict: strict }),
			...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
		});
	}
	return tools;
}

/**
 * 解码 Chat 工具选择字段。
 * @param value - tool_choice 字段
 */
export function decodeChatToolChoice(value: unknown): CanonicalToolChoice | undefined {
	if (typeof value === "string") {
		switch (value) {
			case "auto":
			case "none":
			case "required":
				return { mode: value };
			default:
				return undefined;
		}
	}
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const type = stringAt(record, "type");
	switch (type) {
		case "auto":
			return { mode: "auto" };
		case "none":
			return { mode: "none" };
		case "required":
		case "any":
			return { mode: "required" };
		case "function":
		case "tool": {
			const name = stringAt(recordAt(record, "function"), "name") ?? stringAt(record, "name");
			return name === undefined ? undefined : { mode: "tool", name: name };
		}
		case "allowed_tools": {
			const allowed = recordAt(record, "allowed_tools") ?? record;
			const names: string[] = [];
			for (const tool of asRecordArray(arrayAt(allowed, "tools"))) {
				const name = stringAt(recordAt(tool, "function"), "name") ?? stringAt(tool, "name");
				if (name !== undefined) {
					names.push(name);
				}
			}
			const mode = stringAt(allowed, "mode");
			return {
				mode: mode === "required" || mode === "any" ? "required" : "auto",
				allowedNames: names,
			};
		}
		default:
			return undefined;
	}
}

/**
 * 解码 Chat 结构化输出字段。
 * @param value - response_format 字段
 */
export function decodeChatResponseFormat(value: unknown): CanonicalResponseFormat | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	switch (stringAt(record, "type")) {
		case "text":
			return { type: "text" };
		case "json_object":
			return { type: "json_object" };
		case "json_schema": {
			const nested = recordAt(record, "json_schema") ?? record;
			const name = stringAt(nested, "name");
			const strict = booleanAt(nested, "strict");
			const schema = nested["schema"];
			return {
				type: "json_schema",
				...(name === undefined ? {} : { name: name }),
				...(schema === undefined ? {} : { schema: schema }),
				...(strict === undefined ? {} : { strict: strict }),
			};
		}
		default:
			return undefined;
	}
}

/**
 * 解码 Chat 请求。
 * @param body - Chat 请求体
 * @param fallbackModel - 请求体缺少 model 时使用
 */
export function decodeChatRequest(body: Record<string, unknown>, fallbackModel: string): CanonicalRequest {
	const system: CanonicalContentPart[] = [];
	const messages: CanonicalMessage[] = [];
	const instructions = stringAt(body, "instructions");
	if (instructions !== undefined && instructions.length > 0) {
		system.push({ type: "text", text: instructions });
	}
	for (const message of asRecordArray(body["messages"])) {
		const role = stringAt(message, "role") ?? "user";
		const cacheControl = cacheControlFrom(message);
		if (role === "system" || role === "developer") {
			const parts = decodeChatContent(message["content"]);
			for (const part of parts) {
				if (part.type === "text" || part.type === "image") {
					system.push(part);
				}
			}
			continue;
		}
		if (role === "tool") {
			const toolCallId = stringAt(message, "tool_call_id");
			const content = decodeChatContent(message["content"]);
			messages.push({
				role: "tool",
				parts: [
					{
						type: "tool_result",
						toolCallId: toolCallId ?? "",
						content: content.length > 0 ? content : [{ type: "text", text: "" }],
						...(booleanAt(message, "is_error") === undefined ? {} : { isError: booleanAt(message, "is_error") }),
					},
				],
				...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
			});
			continue;
		}
		if (role !== "user" && role !== "assistant") {
			continue;
		}
		const parts: CanonicalContentPart[] = [];
		if (role === "assistant") {
			parts.push(...decodeChatReasoning(message));
			parts.push(...decodeChatContent(message["content"]));
			parts.push(...decodeChatToolCalls(message["tool_calls"]));
		} else {
			parts.push(...decodeChatContent(message["content"]));
		}
		if (parts.length === 0) {
			continue;
		}
		messages.push({
			role: role,
			parts: parts,
			...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
		});
	}
	const reasoningEffort = stringAt(body, "reasoning_effort") ?? stringAt(recordAt(body, "reasoning"), "effort");
	const thinking = recordAt(body, "thinking");
	const thinkingType = stringAt(thinking, "type");
	const budgetTokens = numberAt(thinking, "budget_tokens");
	const extras: CanonicalRequestExtras = {
		...(stringAt(body, "user") === undefined ? {} : { user: stringAt(body, "user") }),
		...(numberAt(body, "seed") === undefined ? {} : { seed: numberAt(body, "seed") }),
		...(numberAt(body, "n") === undefined ? {} : { n: numberAt(body, "n") }),
		...(numberAt(body, "presence_penalty") === undefined ? {} : { presencePenalty: numberAt(body, "presence_penalty") }),
		...(numberAt(body, "frequency_penalty") === undefined ? {} : { frequencyPenalty: numberAt(body, "frequency_penalty") }),
		...(recordAt(body, "logit_bias") === undefined ? {} : { logitBias: recordAt(body, "logit_bias") }),
		...(booleanAt(body, "logprobs") === undefined ? {} : { logprobs: booleanAt(body, "logprobs") }),
		...(numberAt(body, "top_logprobs") === undefined ? {} : { topLogprobs: numberAt(body, "top_logprobs") }),
		...(stringAt(body, "prompt_cache_key") === undefined ? {} : { promptCacheKey: stringAt(body, "prompt_cache_key") }),
		...(stringAt(body, "service_tier") === undefined ? {} : { serviceTier: stringAt(body, "service_tier") }),
	};
	const maxTokens = numberAt(body, "max_tokens", "max_completion_tokens");
	const responseFormat = decodeChatResponseFormat(body["response_format"]);
	const toolChoice = decodeChatToolChoice(body["tool_choice"]);
	return {
		model: stringAt(body, "model") ?? fallbackModel,
		system: system,
		messages: messages,
		tools: decodeChatTools(body["tools"]),
		...(toolChoice === undefined ? {} : { toolChoice: toolChoice }),
		...(booleanAt(body, "parallel_tool_calls") === undefined ? {} : { parallelToolCalls: booleanAt(body, "parallel_tool_calls") }),
		...(maxTokens === undefined ? {} : { maxTokens: maxTokens }),
		...(numberAt(body, "temperature") === undefined ? {} : { temperature: numberAt(body, "temperature") }),
		...(numberAt(body, "top_p") === undefined ? {} : { topP: numberAt(body, "top_p") }),
		...(numberAt(body, "top_k") === undefined ? {} : { topK: numberAt(body, "top_k") }),
		stop: normalizeStopList(body["stop"]),
		...(booleanAt(body, "stream") === undefined ? {} : { stream: booleanAt(body, "stream") }),
		...(recordAt(body, "metadata") === undefined ? {} : { metadata: recordAt(body, "metadata") }),
		...(reasoningEffort === undefined && thinkingType === undefined && budgetTokens === undefined
			? {}
			: {
					reasoning: {
						...(reasoningEffort === undefined ? {} : { effort: reasoningEffort.toLowerCase() }),
						...(budgetTokens === undefined ? {} : { budgetTokens: budgetTokens }),
						...(thinkingType === "disabled" ? { enabled: false } : {}),
						...(thinkingType === "enabled" || budgetTokens !== undefined ? { enabled: true } : {}),
					},
				}),
		...(responseFormat === undefined ? {} : { responseFormat: responseFormat }),
		...(stringAt(body, "previous_response_id") === undefined
			? {}
			: { previousResponseId: stringAt(body, "previous_response_id") }),
		extras: extras,
	};
}

/**
 * 编码 Chat 内容片段。
 * @param parts - 内容片段
 * @param role - 消息角色
 */
function encodeChatContent(parts: readonly CanonicalContentPart[], role: string): unknown {
	const textParts = parts.filter((part) => part.type === "text");
	const mediaParts = parts.filter((part) => part.type === "image" || part.type === "document");
	const hasCacheControl = textParts.some((part) => part.cacheControl !== undefined);
	if (mediaParts.length === 0 && !hasCacheControl) {
		const text = textParts.map((part) => part.text).join("");
		return text.length === 0 && role === "assistant" ? null : text;
	}
	const content: Record<string, unknown>[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			const cacheControl = cacheControlTo(part.cacheControl);
			content.push({
				type: "text",
				text: part.text,
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			});
		} else if (part.type === "image") {
			content.push({
				type: "image_url",
				image_url: {
					url: part.url,
					...(part.detail === undefined ? {} : { detail: part.detail }),
				},
			});
		} else if (part.type === "document") {
			if (part.text !== undefined && part.url === undefined && part.fileId === undefined) {
				content.push({ type: "text", text: part.text });
				continue;
			}
			const file: Record<string, unknown> = {};
			if (part.url !== undefined) {
				file["file_data"] = part.url;
			}
			if (part.fileId !== undefined) {
				file["file_id"] = part.fileId;
			}
			if (part.title !== undefined) {
				file["filename"] = part.title;
			}
			content.push({ type: "file", file: file });
		}
	}
	return content;
}

/**
 * 编码工具结果内容。
 * @param part - 工具结果片段
 */
function encodeChatToolResultContent(part: CanonicalContentPart & { readonly type: "tool_result" }): unknown {
	const text = part.content.filter((item) => item.type === "text").map((item) => (item.type === "text" ? item.text : ""));
	const hasMedia = part.content.some((item) => item.type === "image" || item.type === "document");
	if (!hasMedia) {
		return text.join("");
	}
	return encodeChatContent(part.content, "user");
}

/**
 * 合并相邻同角色消息。
 * @param messages - 已编码消息列表
 * @param message - 待追加消息
 */
function appendChatMessage(messages: ChatEncodedMessage[], message: ChatEncodedMessage): void {
	const previous = messages.at(-1);
	if (
		previous !== undefined &&
		previous.role === message.role &&
		(previous.role === "user" || previous.role === "assistant") &&
		previous.tool_calls === undefined &&
		message.tool_calls === undefined
	) {
		const previousContent =
			typeof previous.content === "string"
				? previous.content.length > 0
					? [{ type: "text", text: previous.content }]
					: []
				: Array.isArray(previous.content)
					? previous.content
					: [];
		const nextContent =
			typeof message.content === "string"
				? message.content.length > 0
					? [{ type: "text", text: message.content }]
					: []
				: Array.isArray(message.content)
					? message.content
					: [];
		previous.content = [...previousContent, ...nextContent];
		if (message.reasoning_content !== undefined) {
			previous.reasoning_content = `${previous.reasoning_content ?? ""}${message.reasoning_content}`;
		}
		if (message.refusal !== undefined) {
			previous.refusal = `${previous.refusal ?? ""}${message.refusal}`;
		}
		return;
	}
	messages.push(message);
}

/**
 * 编码 Chat 消息列表。
 * @param request - 规范请求
 */
function encodeChatMessages(request: CanonicalRequest): {
	messages: ChatEncodedMessage[];
	system: ChatEncodedMessage | undefined;
} {
	const systemParts: CanonicalContentPart[] = [...request.system];
	for (const message of request.messages) {
		if (message.role === "system") {
			systemParts.push(...message.parts);
		}
	}
	const messages: ChatEncodedMessage[] = [];
	const seenToolIds = new Set<string>();
	for (const message of request.messages) {
		if (message.role !== "assistant") {
			continue;
		}
		for (const part of message.parts) {
			if (part.type === "tool_call") {
				seenToolIds.add(part.id);
			}
		}
	}
	const appendToolResult = (part: CanonicalContentPart): void => {
		if (part.type !== "tool_result") {
			return;
		}
		const content = encodeChatToolResultContent(part);
		if (seenToolIds.has(part.toolCallId)) {
			messages.push({ role: "tool", tool_call_id: part.toolCallId, content: content });
			return;
		}
		// 找不到对应工具调用的结果无法用 tool 角色表达，降级为用户文本。
		appendChatMessage(messages, { role: "user", content: content });
	};
	for (const message of request.messages) {
		if (message.role === "system") {
			continue;
		}
		const cacheControl = cacheControlTo(message.cacheControl);
		if (message.role === "tool") {
			for (const part of message.parts) {
				appendToolResult(part);
			}
			continue;
		}
		if (message.role === "assistant") {
			const thinking = message.parts
				.filter((part) => part.type === "thinking")
				.map((part) => (part.type === "thinking" ? part.text : ""))
				.filter((text) => text.length > 0)
				.join("\n");
			const refusal = message.parts
				.filter((part) => part.type === "refusal")
				.map((part) => (part.type === "refusal" ? part.text : ""))
				.join("");
			const toolCalls: Record<string, unknown>[] = [];
			for (const part of message.parts) {
				if (part.type !== "tool_call") {
					continue;
				}
				toolCalls.push({
					id: part.id,
					type: "function",
					function: { name: part.name, arguments: part.arguments },
				});
			}
			const contentParts = message.parts.filter(
				(part) => part.type === "text" || part.type === "image" || part.type === "document",
			);
			const encoded: ChatEncodedMessage = {
				role: "assistant",
				content: encodeChatContent(contentParts, "assistant"),
				...(thinking.length === 0 ? {} : { reasoning_content: thinking }),
				...(refusal.length === 0 ? {} : { refusal: refusal }),
				...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			};
			appendChatMessage(messages, encoded);
			continue;
		}
		const toolResults = message.parts.filter((part) => part.type === "tool_result");
		for (const part of toolResults) {
			appendToolResult(part);
		}
		const contentParts = message.parts.filter(
			(part) => part.type !== "tool_result" && part.type !== "thinking",
		);
		if (contentParts.length === 0) {
			continue;
		}
		appendChatMessage(messages, {
			role: "user",
			content: encodeChatContent(contentParts, "user"),
			...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
		});
	}
	const systemContent = encodeChatContent(systemParts, "system");
	const hasSystem =
		systemParts.length > 0 && !(typeof systemContent === "string" && systemContent.length === 0);
	const system: ChatEncodedMessage | undefined = hasSystem
		? { role: "system", content: systemContent }
		: undefined;
	return { messages: messages, system: system };
}

/**
 * 编码工具定义。
 * @param tools - 规范工具
 */
function encodeChatTools(tools: readonly CanonicalTool[]): Record<string, unknown>[] {
	return tools.map((tool) => {
		const cacheControl = cacheControlTo(tool.cacheControl);
		return {
			type: "function",
			function: {
				name: tool.name,
				...(tool.description === undefined ? {} : { description: tool.description }),
				...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
				...(tool.strict === undefined ? {} : { strict: tool.strict }),
			},
			...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
		};
	});
}

/**
 * 编码工具选择。
 * @param choice - 规范工具选择
 */
function encodeChatToolChoice(choice: CanonicalToolChoice | undefined): unknown {
	if (!choice) {
		return undefined;
	}
	switch (choice.mode) {
		case "none":
			return "none";
		case "required":
		case "auto": {
			const names = choice.allowedNames;
			if (names !== undefined) {
				if (names.length === 0) {
					return "none";
				}
				return {
					type: "allowed_tools",
					allowed_tools: {
						mode: choice.mode,
						tools: names.map((name) => ({ type: "function", function: { name: name } })),
					},
				};
			}
			return choice.mode;
		}
		case "tool":
			return choice.name === undefined
				? "auto"
				: { type: "function", function: { name: choice.name } };
		default:
			return "auto";
	}
}

/**
 * 编码 Chat 结构化输出。
 * @param format - 规范输出格式
 */
function encodeChatResponseFormat(format: CanonicalResponseFormat | undefined): Record<string, unknown> | undefined {
	if (!format || format.type === "text") {
		return undefined;
	}
	if (format.type === "json_object") {
		return { type: "json_object" };
	}
	return {
		type: "json_schema",
		json_schema: {
			...(format.name === undefined ? {} : { name: format.name }),
			...(format.schema === undefined ? {} : { schema: format.schema }),
			...(format.strict === undefined ? {} : { strict: format.strict }),
		},
	};
}

/**
 * 编码 Chat 请求。
 * @param request - 规范请求
 * @param upstreamModel - 上游模型 ID
 */
export function encodeChatRequest(request: CanonicalRequest, upstreamModel: string): Record<string, unknown> {
	const encoded = encodeChatMessages(request);
	const messages: ChatEncodedMessage[] = [];
	if (encoded.system) {
		messages.push(encoded.system);
	}
	messages.push(...encoded.messages);
	if (messages.length === 0) {
		messages.push({ role: "user", content: "" });
	}
	const body: Record<string, unknown> = {
		model: upstreamModel,
		messages: messages,
	};
	if (request.tools.length > 0) {
		body["tools"] = encodeChatTools(request.tools);
	}
	const toolChoice = encodeChatToolChoice(request.toolChoice);
	if (toolChoice !== undefined) {
		body["tool_choice"] = toolChoice;
	}
	const parallel =
		request.parallelToolCalls ??
		(request.toolChoice?.disableParallelToolUse === true ? false : undefined);
	if (parallel !== undefined) {
		body["parallel_tool_calls"] = parallel;
	}
	if (request.maxTokens !== undefined) {
		body["max_tokens"] = request.maxTokens;
	}
	if (request.temperature !== undefined) {
		body["temperature"] = request.temperature;
	}
	if (request.topP !== undefined) {
		body["top_p"] = request.topP;
	}
	if (request.stop.length > 0) {
		body["stop"] = [...request.stop];
	}
	body["stream"] = request.stream === true;
	const responseFormat = encodeChatResponseFormat(request.responseFormat);
	if (responseFormat !== undefined) {
		body["response_format"] = responseFormat;
	}
	const extras = request.extras;
	if (extras.user !== undefined) {
		body["user"] = extras.user;
	}
	if (extras.seed !== undefined) {
		body["seed"] = extras.seed;
	}
	if (extras.n !== undefined) {
		body["n"] = extras.n;
	}
	if (extras.presencePenalty !== undefined) {
		body["presence_penalty"] = extras.presencePenalty;
	}
	if (extras.frequencyPenalty !== undefined) {
		body["frequency_penalty"] = extras.frequencyPenalty;
	}
	if (extras.logitBias !== undefined) {
		body["logit_bias"] = extras.logitBias;
	}
	if (extras.logprobs !== undefined) {
		body["logprobs"] = extras.logprobs;
	}
	if (extras.topLogprobs !== undefined) {
		body["top_logprobs"] = extras.topLogprobs;
	}
	if (extras.promptCacheKey !== undefined) {
		body["prompt_cache_key"] = extras.promptCacheKey;
	}
	if (extras.serviceTier !== undefined) {
		body["service_tier"] = extras.serviceTier;
	}
	if (request.metadata !== undefined) {
		body["metadata"] = request.metadata;
	}
	const effort =
		request.reasoning?.effort ??
		(request.reasoning?.budgetTokens === undefined ? undefined : budgetToEffort(request.reasoning.budgetTokens));
	if (effort !== undefined) {
		body["reasoning_effort"] = effort;
	} else if (request.reasoning?.enabled === false) {
		body["reasoning_effort"] = "none";
	}
	return body;
}

/**
 * 解码 Chat 响应。
 * @param body - Chat 响应体
 * @param fallbackModel - 响应缺少 model 时使用
 */
export function decodeChatResponse(body: Record<string, unknown>, fallbackModel: string): CanonicalResponse {
	const choice = asRecordArray(body["choices"])[0];
	const message = recordAt(choice, "message") ?? {};
	const parts: CanonicalContentPart[] = [];
	parts.push(...decodeChatReasoning(message));
	for (const part of decodeChatContent(message["content"])) {
		parts.push(part);
	}
	const refusal = stringAt(message, "refusal");
	if (refusal !== undefined && refusal.length > 0) {
		parts.push({ type: "refusal", text: refusal });
	}
	parts.push(...decodeChatToolCalls(message["tool_calls"]));
	const hasToolCalls = parts.some((part) => part.type === "tool_call");
	const baseFinish = finishFromChat(stringAt(choice, "finish_reason"));
	const finishReason: CanonicalFinishReason =
		baseFinish === "length" || baseFinish === "content_filter"
			? baseFinish
			: hasToolCalls
				? "tool_calls"
				: baseFinish;
	return {
		id: stringAt(body, "id") ?? generateId("chatcmpl"),
		createdAt: numberAt(body, "created") ?? Math.floor(Date.now() / 1000),
		model: stringAt(body, "model") ?? fallbackModel,
		parts: parts,
		finishReason: finishReason,
		usage: usageFromChat(recordAt(body, "usage")),
	};
}

/**
 * 编码 Chat 响应。
 * @param response - 规范响应
 * @param model - 对外模型 ID
 */
export function encodeChatResponse(response: CanonicalResponse, model: string): Record<string, unknown> {
	const thinking = response.parts
		.filter((part) => part.type === "thinking")
		.map((part) => (part.type === "thinking" ? part.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
	const refusal = response.parts
		.filter((part) => part.type === "refusal")
		.map((part) => (part.type === "refusal" ? part.text : ""))
		.join("");
	const contentParts = response.parts.filter(
		(part) => part.type === "text" || part.type === "image" || part.type === "document",
	);
	const toolCalls: Record<string, unknown>[] = [];
	for (const part of response.parts) {
		if (part.type === "tool_call") {
			toolCalls.push({
				id: part.id,
				type: "function",
				function: { name: part.name, arguments: part.arguments },
			});
		}
	}
	const encodedContent = encodeChatContent(contentParts, "assistant");
	return {
		id: response.id,
		object: "chat.completion",
		created: response.createdAt,
		model: model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: encodedContent,
					...(thinking.length === 0 ? {} : { reasoning_content: thinking }),
					...(refusal.length === 0 ? {} : { refusal: refusal }),
					...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
				},
				finish_reason: finishToChat(response.finishReason, toolCalls.length > 0),
			},
		],
		usage: chatUsage(response.usage),
	};
}

/**
 * Chat SSE 解码器。
 */
export class ChatStreamDecoder implements CanonicalStreamDecoder {
	private readonly _options: CanonicalStreamOptions;
	private readonly _tools = new Map<number, { id: string; name: string; buffered: string; started: boolean }>();
	private _started = false;
	private _finished = false;

	constructor(options: CanonicalStreamOptions) {
		this._options = options;
	}

	/**
	 * 解码一条上游 SSE 事件。
	 * @param event - 上游事件
	 */
	decode(event: ProtocolEvent): CanonicalStreamEvent[] {
		if (typeof event.data === "string") {
			return [];
		}
		const payload = event.data;
		if (payload["error"] !== undefined) {
			return [this._error(payload["error"])];
		}
		const events: CanonicalStreamEvent[] = [];
		if (!this._started) {
			this._started = true;
			events.push({
				type: "start",
				id: stringAt(payload, "id") ?? generateId("chatcmpl"),
				model: stringAt(payload, "model") ?? this._options.upstreamModel,
				createdAt: numberAt(payload, "created") ?? Math.floor(Date.now() / 1000),
			});
		}
		const usage = recordAt(payload, "usage");
		if (usage) {
			events.push({ type: "usage", usage: usageFromChat(usage) });
		}
		for (const choice of asRecordArray(payload["choices"])) {
			const delta = recordAt(choice, "delta") ?? {};
			const content = delta["content"];
			if (typeof content === "string") {
				if (content.length > 0) {
					events.push({ type: "text_delta", text: content });
				}
			} else if (Array.isArray(content)) {
				for (const part of decodeChatContent(content)) {
					if (part.type === "text" && part.text.length > 0) {
						events.push({ type: "text_delta", text: part.text });
					}
				}
			}
			const reasoning = reasoningTextOf(delta);
			if (reasoning.length > 0) {
				events.push({ type: "thinking_delta", text: reasoning });
			}
			const refusal = stringAt(delta, "refusal");
			if (refusal !== undefined && refusal.length > 0) {
				events.push({ type: "refusal_delta", text: refusal });
			}
			for (const rawCall of asRecordArray(delta["tool_calls"])) {
				events.push(...this._toolDelta(rawCall));
			}
			const finish = stringAt(choice, "finish_reason");
			if (finish !== undefined && finish.length > 0 && !this._finished) {
				events.push(...this._closeTools());
				this._finished = true;
				events.push({ type: "finish", reason: finishFromChat(finish) });
			}
		}
		return events;
	}

	private _toolDelta(rawCall: Record<string, unknown>): CanonicalStreamEvent[] {
		const events: CanonicalStreamEvent[] = [];
		const index = numberAt(rawCall, "index") ?? 0;
		const fn = recordAt(rawCall, "function");
		const state = this._tools.get(index) ?? { id: "", name: "", buffered: "", started: false };
		const id = stringAt(rawCall, "id");
		if (id !== undefined && id.length > 0) {
			state.id = id;
		}
		const name = stringAt(fn, "name");
		if (name !== undefined && name.length > 0) {
			state.name = name;
		}
		const args = stringAt(fn, "arguments");
		if (args !== undefined && args.length > 0) {
			if (state.started) {
				events.push({ type: "tool_call_arguments", index: index, delta: args });
			} else {
				state.buffered += args;
			}
		}
		if (!state.started && state.name.length > 0) {
			state.started = true;
			events.push({
				type: "tool_call_start",
				index: index,
				id: state.id.length > 0 ? state.id : generateId("call"),
				name: state.name,
			});
			if (state.buffered.length > 0) {
				events.push({ type: "tool_call_arguments", index: index, delta: state.buffered });
				state.buffered = "";
			}
		}
		this._tools.set(index, state);
		return events;
	}

	private _closeTools(): CanonicalStreamEvent[] {
		const events: CanonicalStreamEvent[] = [];
		for (const [index, state] of [...this._tools.entries()].sort(([left], [right]) => left - right)) {
			if (!state.started) {
				state.started = true;
				events.push({
					type: "tool_call_start",
					index: index,
					id: state.id.length > 0 ? state.id : generateId("call"),
					name: state.name,
				});
				if (state.buffered.length > 0) {
					events.push({ type: "tool_call_arguments", index: index, delta: state.buffered });
					state.buffered = "";
				}
			}
			events.push({ type: "tool_call_stop", index: index });
		}
		return events;
	}

	private _error(error: unknown): CanonicalStreamEvent {
		const record = asRecord(error);
		return {
			type: "error",
			errorType: stringAt(record, "type", "code") ?? "upstream_error",
			message: stringAt(record, "message") ?? "上游流式响应失败",
		};
	}
}

/**
 * Chat SSE 编码器。
 */
export class ChatStreamEncoder implements CanonicalStreamEncoder {
	private readonly _options: CanonicalStreamOptions;
	private _id = "";
	private _model = "";
	private _created = 0;
	private _started = false;
	private _finished = false;
	private _terminal = false;
	private _usage: CanonicalUsage | undefined;
	private _usageEmitted = false;
	private _sawToolCall = false;

	constructor(options: CanonicalStreamOptions) {
		this._options = options;
	}

	/**
	 * 编码一条规范流事件。
	 * @param event - 规范事件
	 */
	encode(event: CanonicalStreamEvent): ProtocolEvent[] {
		if (this._terminal) {
			return [];
		}
		switch (event.type) {
			case "start":
				this._id = event.id;
				this._model = this._options.model;
				this._created = event.createdAt;
				if (event.usage !== undefined) {
					this._usage = event.usage;
				}
				return this._startFrames();
			case "text_delta":
				return [...this._startFrames(), this._chunk({ content: event.text }, null)];
			case "refusal_delta":
				return [...this._startFrames(), this._chunk({ refusal: event.text }, null)];
			case "thinking_delta":
				return [...this._startFrames(), this._chunk({ reasoning_content: event.text }, null)];
			case "thinking_signature":
				return [];
			case "tool_call_start":
				this._sawToolCall = true;
				return [
					...this._startFrames(),
					this._chunk(
						{
							tool_calls: [
								{
									index: event.index,
									id: event.id,
									type: "function",
									function: { name: event.name, arguments: "" },
								},
							],
						},
						null,
					),
				];
			case "tool_call_arguments":
				return [
					...this._startFrames(),
					this._chunk({ tool_calls: [{ index: event.index, function: { arguments: event.delta } }] }, null),
				];
			case "tool_call_stop":
				return [];
			case "usage":
				this._usage = event.usage;
				return this._finished ? this._usageFrames() : [];
			case "finish": {
				if (this._finished) {
					return [];
				}
				this._finished = true;
				const frames = [
					...this._startFrames(),
					this._chunk({}, finishToChat(event.reason, this._sawToolCall)),
					...this._usageFrames(),
				];
				return frames;
			}
			case "error": {
				this._finished = true;
				return [
					...this._startFrames(),
					{ data: { error: { message: event.message, type: event.errorType } } },
				];
			}
			case "ping":
				return [];
			default:
				return [];
		}
	}

	/**
	 * 冲刷终止帧。
	 */
	flush(): ProtocolEvent[] {
		if (this._terminal) {
			return [];
		}
		const frames: ProtocolEvent[] = [];
		if (!this._finished) {
			frames.push(...this._startFrames());
			frames.push(this._chunk({}, finishToChat("stop", false)));
			this._finished = true;
		}
		frames.push(...this._usageFrames());
		if (this._options.includeDone !== false) {
			frames.push({ data: "[DONE]" });
		}
		this._terminal = true;
		return frames;
	}

	private _ensureIdentity(): void {
		if (!this._started) {
			this._started = true;
			if (this._id.length === 0) {
				this._id = generateId("chatcmpl");
			}
			if (this._model.length === 0) {
				this._model = this._options.model;
			}
			if (this._created === 0) {
				this._created = Math.floor(Date.now() / 1000);
			}
		}
	}

	private _startFrames(): ProtocolEvent[] {
		if (this._started) {
			return [];
		}
		this._ensureIdentity();
		return [
			{
				data: {
					id: this._id,
					object: "chat.completion.chunk",
					created: this._created,
					model: this._model,
					choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
				},
			},
		];
	}

	private _chunk(delta: Record<string, unknown>, finishReason: string | null): ProtocolEvent {
		this._ensureIdentity();
		return {
			data: {
				id: this._id,
				object: "chat.completion.chunk",
				created: this._created,
				model: this._model,
				choices: [{ index: 0, delta: delta, finish_reason: finishReason }],
			},
		};
	}

	private _usageFrames(): ProtocolEvent[] {
		if (this._usage === undefined || this._usageEmitted) {
			return [];
		}
		this._usageEmitted = true;
		this._ensureIdentity();
		return [
			{
				data: {
					id: this._id,
					object: "chat.completion.chunk",
					created: this._created,
					model: this._model,
					choices: [],
					usage: chatUsage(this._usage),
				},
			},
		];
	}
}

/**
 * 创建 Chat 流解码器。
 * @param options - 流式选项
 */
export function createChatStreamDecoder(options: CanonicalStreamOptions): CanonicalStreamDecoder {
	return new ChatStreamDecoder(options);
}

/**
 * 创建 Chat 流编码器。
 * @param options - 流式选项
 */
export function createChatStreamEncoder(options: CanonicalStreamOptions): CanonicalStreamEncoder {
	return new ChatStreamEncoder(options);
}
