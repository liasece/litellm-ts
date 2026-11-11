/**
 * OpenAI Responses API 协议的请求、响应与流式事件编解码。
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
	generateId,
	mergeAdjacentText,
	numberAt,
	partsToText,
	recordAt,
	responsesUsage,
	stringAt,
	stringifyArguments,
	toResponsesId,
	usageFromResponses,
} from "./shared";

/**
 * 解码 Responses 内容数组。
 * @param content - input 消息的 content 字段
 */
function decodeResponsesContent(content: unknown): CanonicalContentPart[] {
	if (typeof content === "string") {
		return content.length === 0 ? [] : [{ type: "text", text: content }];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: CanonicalContentPart[] = [];
	for (const raw of content) {
		const part = asRecord(raw);
		if (!part) {
			continue;
		}
		switch (stringAt(part, "type")) {
			case "input_text":
			case "output_text":
			case "text": {
				const text = stringAt(part, "text") ?? "";
				if (text.length > 0) {
					parts.push({ type: "text", text: text });
				}
				break;
			}
			case "input_image":
			case "image_url": {
				const imageUrl = part["image_url"];
				const imageRecord = asRecord(imageUrl);
				const url = typeof imageUrl === "string" ? imageUrl : stringAt(imageRecord, "url");
				if (url !== undefined && url.length > 0) {
					const detail = stringAt(imageRecord, "detail") ?? stringAt(part, "detail");
					parts.push({
						type: "image",
						url: url,
						...(detail === undefined ? {} : { detail: detail }),
					});
				}
				break;
			}
			case "input_file": {
				const fileId = stringAt(part, "file_id");
				const fileData = stringAt(part, "file_data");
				const filename = stringAt(part, "filename");
				if (fileId !== undefined) {
					parts.push({
						type: "document",
						fileId: fileId,
						...(filename === undefined ? {} : { title: filename }),
					});
				} else if (fileData !== undefined) {
					parts.push({
						type: "document",
						url: fileData,
						...(filename === undefined ? {} : { title: filename }),
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
 * 汇总 Responses reasoning 项的文本。
 * @param item - reasoning 项
 */
function reasoningItemText(item: Record<string, unknown>): string {
	const summary = asRecordArray(item["summary"]);
	const texts: string[] = [];
	for (const part of summary) {
		const text = stringAt(part, "text");
		if (text !== undefined && text.length > 0) {
			texts.push(text);
		}
	}
	if (texts.length === 0) {
		for (const part of asRecordArray(item["content"])) {
			const text = stringAt(part, "text");
			if (text !== undefined && text.length > 0) {
				texts.push(text);
			}
		}
	}
	return texts.join("");
}

/**
 * 解码 Responses 工具定义。
 * @param value - tools 字段
 */
export function decodeResponsesTools(value: unknown): CanonicalTool[] {
	const tools: CanonicalTool[] = [];
	for (const raw of asRecordArray(value)) {
		if (stringAt(raw, "type") !== "function") {
			continue;
		}
		const fn = recordAt(raw, "function") ?? raw;
		const name = stringAt(fn, "name");
		if (name === undefined || name.length === 0) {
			continue;
		}
		const description = stringAt(fn, "description");
		const parameters = recordAt(fn, "parameters", "input_schema");
		const strict = booleanAt(fn, "strict") ?? booleanAt(raw, "strict");
		tools.push({
			name: name,
			...(description === undefined ? {} : { description: description }),
			...(parameters === undefined ? {} : { parameters: parameters }),
			...(strict === undefined ? {} : { strict: strict }),
		});
	}
	return tools;
}

/**
 * 解码 Responses 工具选择。
 * @param value - tool_choice 字段
 */
export function decodeResponsesToolChoice(value: unknown): CanonicalToolChoice | undefined {
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
	switch (stringAt(record, "type")) {
		case "auto":
			return { mode: "auto" };
		case "none":
			return { mode: "none" };
		case "required":
		case "any":
			return { mode: "required" };
		case "function":
		case "tool": {
			const name = stringAt(record, "name") ?? stringAt(recordAt(record, "function"), "name");
			return name === undefined ? { mode: "required" } : { mode: "tool", name: name };
		}
		case "allowed_tools": {
			const allowed = recordAt(record, "allowed_tools") ?? record;
			const names: string[] = [];
			for (const tool of asRecordArray(arrayAt(allowed, "tools"))) {
				const name = stringAt(tool, "name") ?? stringAt(recordAt(tool, "function"), "name");
				if (name !== undefined) {
					names.push(name);
				}
			}
			const mode = stringAt(allowed, "mode");
			return {
				mode: mode === "required" ? "required" : "auto",
				allowedNames: names,
			};
		}
		default:
			return undefined;
	}
}

/**
 * 解码 Responses 结构化输出配置。
 * @param value - text.format 字段
 */
export function decodeResponsesResponseFormat(value: unknown): CanonicalResponseFormat | undefined {
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
			const name = stringAt(record, "name");
			const strict = booleanAt(record, "strict");
			const schema = record["schema"];
			return {
				type: "json_schema",
				...(name === undefined ? {} : { name: name }),
				...(strict === undefined ? {} : { strict: strict }),
				...(schema === undefined ? {} : { schema: schema }),
			};
		}
		default:
			return undefined;
	}
}

/**
 * 解码 Responses 请求。
 * @param body - Responses 请求体
 * @param fallbackModel - 请求体缺少 model 时使用
 */
export function decodeResponsesRequest(body: Record<string, unknown>, fallbackModel: string): CanonicalRequest {
	const system: CanonicalContentPart[] = [];
	const instructions = body["instructions"];
	if (typeof instructions === "string") {
		if (instructions.length > 0) {
			system.push({ type: "text", text: instructions });
		}
	} else {
		system.push(...decodeResponsesContent(instructions));
	}
	const messages: CanonicalMessage[] = [];
	let pendingAssistant: CanonicalContentPart[] = [];
	const flushPending = (): void => {
		if (pendingAssistant.length === 0) {
			return;
		}
		messages.push({ role: "assistant", parts: pendingAssistant });
		pendingAssistant = [];
	};
	const input = body["input"];
	const items: unknown[] =
		typeof input === "string"
			? [input]
			: Array.isArray(input)
				? input
				: asRecord(input) === undefined
					? []
					: [input];
	for (const raw of items) {
		if (typeof raw === "string") {
			flushPending();
			messages.push({ role: "user", parts: [{ type: "text", text: raw }] });
			continue;
		}
		const item = asRecord(raw);
		if (!item) {
			continue;
		}
		const type = stringAt(item, "type") ?? "message";
		switch (type) {
			case "message": {
				const role = stringAt(item, "role") ?? "user";
				const parts = decodeResponsesContent(item["content"]);
				if (role === "system" || role === "developer") {
					system.push(...parts.filter((part) => part.type === "text" || part.type === "image"));
					break;
				}
				if (role === "assistant") {
					const combined = [...pendingAssistant, ...parts];
					pendingAssistant = [];
					if (combined.length > 0) {
						messages.push({ role: "assistant", parts: combined });
					}
					break;
				}
				flushPending();
				if (parts.length > 0) {
					messages.push({ role: "user", parts: parts });
				}
				break;
			}
			case "function_call": {
				const name = stringAt(item, "name");
				if (name === undefined || name.length === 0) {
					break;
				}
				pendingAssistant.push({
					type: "tool_call",
					id: stringAt(item, "call_id", "id") ?? generateId("call"),
					name: name,
					arguments: stringifyArguments(item["arguments"]),
				});
				break;
			}
			case "function_call_output": {
				flushPending();
				const content = decodeResponsesContent(item["output"]);
				const text = typeof item["output"] === "string" ? item["output"] : stringAt(item, "output");
				const parts: CanonicalContentPart[] =
					content.length > 0
						? content
						: [{ type: "text", text: text ?? "" }];
				messages.push({
					role: "tool",
					parts: [
						{
							type: "tool_result",
							toolCallId: stringAt(item, "call_id", "id") ?? "",
							content: parts,
						},
					],
				});
				break;
			}
			case "reasoning": {
				const text = reasoningItemText(item);
				const encrypted = stringAt(item, "encrypted_content");
				pendingAssistant.push({
					type: "thinking",
					text: text,
					...(encrypted === undefined ? {} : { signature: encrypted }),
				});
				break;
			}
			default:
				// item_reference、内建工具调用等无法跨协议表达，安全忽略。
				break;
		}
	}
	flushPending();
	const reasoning = recordAt(body, "reasoning");
	const text = recordAt(body, "text");
	const format = decodeResponsesResponseFormat(text?.["format"]);
	const toolChoice = decodeResponsesToolChoice(body["tool_choice"]);
	const extras: CanonicalRequestExtras = {
		...(stringAt(body, "user") === undefined ? {} : { user: stringAt(body, "user") }),
		...(stringAt(body, "prompt_cache_key") === undefined
			? {}
			: { promptCacheKey: stringAt(body, "prompt_cache_key") }),
		...(booleanAt(body, "store") === undefined ? {} : { store: booleanAt(body, "store") }),
		...(stringAt(body, "truncation") === undefined ? {} : { truncation: stringAt(body, "truncation") }),
		...(stringAt(body, "service_tier") === undefined ? {} : { serviceTier: stringAt(body, "service_tier") }),
		...(stringAt(text, "verbosity") === undefined ? {} : { textVerbosity: stringAt(text, "verbosity") }),
		...(Array.isArray(body["include"]) ? { include: body["include"].filter((item): item is string => typeof item === "string") } : {}),
	};
	const maxTokens = numberAt(body, "max_output_tokens");
	const effort = stringAt(reasoning, "effort");
	const summary = stringAt(reasoning, "summary");
	return {
		model: stringAt(body, "model") ?? fallbackModel,
		system: system,
		messages: messages,
		tools: decodeResponsesTools(body["tools"]),
		...(toolChoice === undefined ? {} : { toolChoice: toolChoice }),
		...(booleanAt(body, "parallel_tool_calls") === undefined
			? {}
			: { parallelToolCalls: booleanAt(body, "parallel_tool_calls") }),
		...(maxTokens === undefined ? {} : { maxTokens: maxTokens }),
		...(numberAt(body, "temperature") === undefined ? {} : { temperature: numberAt(body, "temperature") }),
		...(numberAt(body, "top_p") === undefined ? {} : { topP: numberAt(body, "top_p") }),
		stop: [],
		...(booleanAt(body, "stream") === undefined ? {} : { stream: booleanAt(body, "stream") }),
		...(recordAt(body, "metadata") === undefined ? {} : { metadata: recordAt(body, "metadata") }),
		...(effort === undefined && summary === undefined
			? {}
			: {
					reasoning: {
						...(effort === undefined ? {} : { effort: effort.toLowerCase() }),
						...(summary === undefined ? {} : { summary: summary }),
						...(effort !== undefined && effort.toLowerCase() === "none" ? { enabled: false } : {}),
					},
				}),
		...(format === undefined ? {} : { responseFormat: format }),
		...(stringAt(body, "previous_response_id") === undefined
			? {}
			: { previousResponseId: stringAt(body, "previous_response_id") }),
		extras: extras,
	};
}

/**
 * 编码 Responses 内容数组。
 * @param parts - 内容片段
 * @param role - 输入消息角色
 */
function encodeResponsesContent(parts: readonly CanonicalContentPart[], role: "user" | "assistant"): Record<string, unknown>[] {
	const content: Record<string, unknown>[] = [];
	for (const part of parts) {
		switch (part.type) {
			case "text":
			case "refusal": {
				const type = role === "assistant" ? "output_text" : "input_text";
				content.push({ type: type, text: part.text });
				break;
			}
			case "image": {
				content.push({
					type: "input_image",
					image_url: part.url,
					...(part.detail === undefined ? {} : { detail: part.detail }),
				});
				break;
			}
			case "document": {
				if (part.text !== undefined && part.url === undefined && part.fileId === undefined) {
					content.push({ type: role === "assistant" ? "output_text" : "input_text", text: part.text });
					break;
				}
				content.push({
					type: "input_file",
					...(part.fileId === undefined ? {} : { file_id: part.fileId }),
					...(part.url === undefined ? {} : { file_data: part.url }),
					...(part.title === undefined ? {} : { filename: part.title }),
				});
				break;
			}
			default:
				break;
		}
	}
	return content;
}

/**
 * 编码 Responses 输入项。
 * @param request - 规范请求
 */
function encodeResponsesInput(request: CanonicalRequest): Record<string, unknown>[] {
	const input: Record<string, unknown>[] = [];
	const seenCallIds = new Set<string>();
	const appendToolOutput = (part: CanonicalContentPart): void => {
		if (part.type !== "tool_result") {
			return;
		}
		const text = partsToText(part.content);
		const content = encodeResponsesContent(part.content, "user");
		if (request.previousResponseId !== undefined || seenCallIds.has(part.toolCallId)) {
			input.push({
				type: "function_call_output",
				call_id: part.toolCallId,
				output:
					content.length === 0 || (content.length === 1 && content[0]?.["type"] === "input_text")
						? text
						: content,
			});
			return;
		}
		// 找不到对应函数调用时 Responses 会拒绝 function_call_output，降级为用户消息。
		input.push({ type: "message", role: "user", content: content });
	};
	for (const message of request.messages) {
		if (message.role === "system") {
			continue;
		}
		if (message.role === "tool") {
			for (const part of message.parts) {
				appendToolOutput(part);
			}
			continue;
		}
		if (message.role === "assistant") {
			for (const part of mergeAdjacentText(message.parts)) {
				if (part.type === "thinking") {
					if (part.redacted) {
						continue;
					}
					input.push({
						type: "reasoning",
						summary: part.text.length === 0 ? [] : [{ type: "summary_text", text: part.text }],
						...(part.signature === undefined ? {} : { encrypted_content: part.signature }),
					});
				} else if (part.type === "tool_call") {
					seenCallIds.add(part.id);
					input.push({
						type: "function_call",
						call_id: part.id,
						name: part.name,
						arguments: part.arguments,
					});
				} else if (part.type === "text" || part.type === "refusal" || part.type === "image" || part.type === "document") {
					input.push({
						type: "message",
						role: "assistant",
						content: encodeResponsesContent([part], "assistant"),
					});
				}
			}
			continue;
		}
		const toolResults = message.parts.filter((part) => part.type === "tool_result");
		for (const part of toolResults) {
			appendToolOutput(part);
		}
		const contentParts = message.parts.filter(
			(part) => part.type === "text" || part.type === "image" || part.type === "document" || part.type === "refusal",
		);
		if (contentParts.length > 0) {
			input.push({
				type: "message",
				role: "user",
				content: encodeResponsesContent(contentParts, "user"),
			});
		}
	}
	return input;
}

/**
 * 编码 Responses 工具定义。
 * @param tools - 规范工具
 */
function encodeResponsesTools(tools: readonly CanonicalTool[]): Record<string, unknown>[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		...(tool.description === undefined ? {} : { description: tool.description }),
		parameters: tool.parameters ?? { type: "object", properties: {} },
		...(tool.strict === undefined ? {} : { strict: tool.strict }),
	}));
}

/**
 * 编码 Responses 工具选择。
 * @param choice - 规范工具选择
 */
function encodeResponsesToolChoice(choice: CanonicalToolChoice | undefined): unknown {
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
						tools: names.map((name) => ({ type: "function", name: name })),
					},
				};
			}
			return choice.mode;
		}
		case "tool":
			return choice.name === undefined ? "auto" : { type: "function", name: choice.name };
		default:
			return "auto";
	}
}

/**
 * 编码 Responses 结构化输出。
 * @param format - 规范输出格式
 */
function encodeResponsesFormat(format: CanonicalResponseFormat | undefined): Record<string, unknown> | undefined {
	if (!format || format.type === "text") {
		return undefined;
	}
	if (format.type === "json_object") {
		return { type: "json_object" };
	}
	return {
		type: "json_schema",
		...(format.name === undefined ? {} : { name: format.name }),
		...(format.schema === undefined ? {} : { schema: format.schema }),
		...(format.strict === undefined ? {} : { strict: format.strict }),
	};
}

/**
 * 编码 Responses 请求。
 * @param request - 规范请求
 * @param upstreamModel - 上游模型 ID
 */
export function encodeResponsesRequest(request: CanonicalRequest, upstreamModel: string): Record<string, unknown> {
	const systemTexts: string[] = [];
	for (const part of request.system) {
		if (part.type === "text" && part.text.length > 0) {
			systemTexts.push(part.text);
		}
	}
	for (const message of request.messages) {
		if (message.role !== "system") {
			continue;
		}
		for (const part of message.parts) {
			if (part.type === "text" && part.text.length > 0) {
				systemTexts.push(part.text);
			}
		}
	}
	const input = encodeResponsesInput(request);
	const body: Record<string, unknown> = {
		model: upstreamModel,
	};
	if (systemTexts.length > 0) {
		body["instructions"] = systemTexts.join("\n\n");
	}
	if (input.length > 0) {
		body["input"] = input;
	} else if (request.previousResponseId === undefined) {
		body["input"] = [{ type: "message", role: "user", content: [{ type: "input_text", text: "" }] }];
	}
	if (request.tools.length > 0) {
		body["tools"] = encodeResponsesTools(request.tools);
	}
	const toolChoice = encodeResponsesToolChoice(request.toolChoice);
	if (toolChoice !== undefined) {
		body["tool_choice"] = toolChoice;
	}
	if (request.parallelToolCalls !== undefined) {
		body["parallel_tool_calls"] = request.parallelToolCalls;
	}
	if (request.maxTokens !== undefined) {
		body["max_output_tokens"] = request.maxTokens;
	}
	if (request.temperature !== undefined) {
		body["temperature"] = request.temperature;
	}
	if (request.topP !== undefined) {
		body["top_p"] = request.topP;
	}
	body["stream"] = request.stream === true;
	if (request.metadata !== undefined) {
		body["metadata"] = request.metadata;
	}
	if (request.previousResponseId !== undefined) {
		body["previous_response_id"] = request.previousResponseId;
	}
	const reasoning = request.reasoning;
	const effort =
		reasoning?.effort ?? (reasoning?.budgetTokens === undefined ? undefined : budgetToEffort(reasoning.budgetTokens));
	if (effort !== undefined || reasoning?.summary !== undefined) {
		body["reasoning"] = {
			...(effort === undefined ? {} : { effort: effort }),
			...(reasoning?.summary === undefined ? {} : { summary: reasoning.summary }),
		};
	}
	const format = encodeResponsesFormat(request.responseFormat);
	if (format !== undefined || request.extras.textVerbosity !== undefined) {
		body["text"] = {
			...(format === undefined ? {} : { format: format }),
			...(request.extras.textVerbosity === undefined ? {} : { verbosity: request.extras.textVerbosity }),
		};
	}
	const extras = request.extras;
	if (extras.promptCacheKey !== undefined) {
		body["prompt_cache_key"] = extras.promptCacheKey;
	}
	if (extras.store !== undefined) {
		body["store"] = extras.store;
	}
	if (extras.truncation !== undefined) {
		body["truncation"] = extras.truncation;
	}
	if (extras.include !== undefined) {
		body["include"] = [...extras.include];
	}
	if (extras.serviceTier !== undefined) {
		body["service_tier"] = extras.serviceTier;
	}
	if (extras.user !== undefined) {
		body["user"] = extras.user;
	}
	return body;
}

/**
 * 解码 Responses 响应。
 * @param body - Responses 响应体
 * @param fallbackModel - 响应缺少 model 时使用
 */
export function decodeResponsesResponse(body: Record<string, unknown>, fallbackModel: string): CanonicalResponse {
	const parts: CanonicalContentPart[] = [];
	for (const item of asRecordArray(body["output"])) {
		const type = stringAt(item, "type");
		if (type === "message") {
			for (const part of decodeResponsesContent(item["content"])) {
				parts.push(part);
			}
		} else if (type === "function_call") {
			const name = stringAt(item, "name");
			if (name !== undefined && name.length > 0) {
				parts.push({
					type: "tool_call",
					id: stringAt(item, "call_id", "id") ?? generateId("call"),
					name: name,
					arguments: stringifyArguments(item["arguments"]),
				});
			}
		} else if (type === "reasoning") {
			const text = reasoningItemText(item);
			const encrypted = stringAt(item, "encrypted_content");
			parts.push({
				type: "thinking",
				text: text,
				...(encrypted === undefined ? {} : { signature: encrypted }),
			});
		}
	}
	const status = stringAt(body, "status");
	const hasToolCalls = parts.some((part) => part.type === "tool_call");
	let finishReason: CanonicalFinishReason = hasToolCalls ? "tool_calls" : "stop";
	if (status === "incomplete") {
		const incompleteReason = stringAt(recordAt(body, "incomplete_details"), "reason");
		finishReason = incompleteReason === "content_filter" ? "content_filter" : "length";
	} else if (status === "failed") {
		finishReason = "error";
	}
	return {
		id: stringAt(body, "id") ?? generateId("resp"),
		createdAt: numberAt(body, "created_at") ?? Math.floor(Date.now() / 1000),
		model: stringAt(body, "model") ?? fallbackModel,
		parts: parts,
		finishReason: finishReason,
		usage: usageFromResponses(recordAt(body, "usage")),
	};
}

/**
 * 构造 Responses 输出项。
 * @param response - 规范响应
 * @param responseId - 对外响应 ID
 */
function encodeResponsesOutput(
	response: CanonicalResponse,
	responseId: string,
): Record<string, unknown>[] {
	const output: Record<string, unknown>[] = [];
	let index = 0;
	const reasoningTexts = response.parts
		.filter((part) => part.type === "thinking" && !part.redacted)
		.map((part) => (part.type === "thinking" ? part.text : ""))
		.filter((text) => text.length > 0);
	if (reasoningTexts.length > 0) {
		const signature = response.parts.find(
			(part) => part.type === "thinking" && part.signature !== undefined,
		);
		output.push({
			id: `${responseId}_reasoning_${index}`,
			type: "reasoning",
			status: "completed",
			summary: [{ type: "summary_text", text: reasoningTexts.join("") }],
			...(signature !== undefined && signature.type === "thinking"
				? { encrypted_content: signature.signature }
				: {}),
		});
		index++;
	}
	const text = response.parts
		.filter((part) => part.type === "text")
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
	const refusal = response.parts
		.filter((part) => part.type === "refusal")
		.map((part) => (part.type === "refusal" ? part.text : ""))
		.join("");
	if (text.length > 0 || refusal.length > 0) {
		const content: Record<string, unknown>[] = [];
		if (text.length > 0) {
			content.push({ type: "output_text", annotations: [], logprobs: [], text: text });
		}
		if (refusal.length > 0) {
			content.push({ type: "refusal", refusal: refusal });
		}
		output.push({
			id: `${responseId}_message_${index}`,
			type: "message",
			status: "completed",
			role: "assistant",
			content: content,
		});
		index++;
	}
	for (const part of response.parts) {
		if (part.type !== "tool_call") {
			continue;
		}
		output.push({
			id: `${responseId}_function_${index}`,
			type: "function_call",
			status: "completed",
			call_id: part.id,
			name: part.name,
			arguments: part.arguments,
		});
		index++;
	}
	return output;
}

/**
 * 编码 Responses 响应。
 * @param response - 规范响应
 * @param model - 对外模型 ID
 */
export function encodeResponsesResponse(response: CanonicalResponse, model: string): Record<string, unknown> {
	const responseId = toResponsesId(response.id);
	const output = encodeResponsesOutput(response, responseId);
	const status =
		response.finishReason === "length"
			? "incomplete"
			: response.finishReason === "content_filter"
				? "incomplete"
				: response.finishReason === "error"
					? "failed"
					: "completed";
	const failed = status === "failed";
	return {
		id: responseId,
		object: "response",
		created_at: response.createdAt,
		completed_at: status === "completed" ? Math.floor(Date.now() / 1000) : null,
		status: status,
		error: failed ? { code: "upstream_error", message: "上游返回失败状态" } : null,
		incomplete_details:
			status === "incomplete"
				? { reason: response.finishReason === "content_filter" ? "content_filter" : "max_output_tokens" }
				: null,
		instructions: null,
		model: model,
		output: output,
		parallel_tool_calls: true,
		previous_response_id: null,
		reasoning: { effort: null, summary: null },
		store: false,
		temperature: 1,
		text: { format: { type: "text" } },
		tool_choice: "auto",
		tools: [],
		top_p: 1,
		truncation: "disabled",
		usage: responsesUsage(response.usage),
		user: null,
		metadata: {},
	};
}

/**
 * Responses SSE 解码器。
 */
export class ResponsesStreamDecoder implements CanonicalStreamDecoder {
	private readonly _options: CanonicalStreamOptions;
	private readonly _toolIndexByOutput = new Map<number, number>();
	private readonly _toolArguments = new Map<number, string>();
	private _nextToolIndex = 0;
	private _sawToolCall = false;
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
		const type = stringAt(payload, "type") ?? event.event ?? "";
		const events: CanonicalStreamEvent[] = [];
		switch (type) {
			case "response.created": {
				const response = recordAt(payload, "response");
				if (this._started) {
					break;
				}
				this._started = true;
				events.push({
					type: "start",
					id: stringAt(response, "id") ?? generateId("resp"),
					model: stringAt(response, "model") ?? this._options.upstreamModel,
					createdAt: numberAt(response, "created_at") ?? Math.floor(Date.now() / 1000),
				});
				break;
			}
			case "response.output_item.added": {
				const item = recordAt(payload, "item");
				const itemType = stringAt(item, "type");
				if (itemType === "function_call" || itemType === "custom_tool_call") {
					const outputIndex = numberAt(payload, "output_index") ?? this._nextToolIndex;
					const toolIndex = this._nextToolIndex++;
					this._sawToolCall = true;
					this._toolIndexByOutput.set(outputIndex, toolIndex);
					const initial = stringAt(item, "arguments") ?? stringAt(item, "input") ?? "";
					this._toolArguments.set(toolIndex, initial);
					events.push({
						type: "tool_call_start",
						index: toolIndex,
						id: stringAt(item, "call_id", "id") ?? generateId("call"),
						name: stringAt(item, "name") ?? "",
					});
					if (initial.length > 0) {
						events.push({ type: "tool_call_arguments", index: toolIndex, delta: initial });
					}
				}
				break;
			}
			case "response.output_text.delta": {
				const delta = stringAt(payload, "delta");
				if (delta !== undefined && delta.length > 0) {
					events.push({ type: "text_delta", text: delta });
				}
				break;
			}
			case "response.reasoning_summary_text.delta":
			case "response.reasoning_text.delta": {
				const delta = stringAt(payload, "delta");
				if (delta !== undefined && delta.length > 0) {
					events.push({ type: "thinking_delta", text: delta });
				}
				break;
			}
			case "response.function_call_arguments.delta": {
				const outputIndex = numberAt(payload, "output_index") ?? 0;
				let toolIndex = this._toolIndexByOutput.get(outputIndex);
				if (toolIndex === undefined) {
					toolIndex = this._nextToolIndex++;
					this._toolIndexByOutput.set(outputIndex, toolIndex);
					events.push({
						type: "tool_call_start",
						index: toolIndex,
						id: generateId("call"),
						name: "",
					});
				}
				const delta = stringAt(payload, "delta");
				if (delta !== undefined && delta.length > 0) {
					this._toolArguments.set(toolIndex, `${this._toolArguments.get(toolIndex) ?? ""}${delta}`);
					events.push({ type: "tool_call_arguments", index: toolIndex, delta: delta });
				}
				break;
			}
			case "response.output_item.done": {
				const item = recordAt(payload, "item");
				const itemType = stringAt(item, "type");
				if (itemType !== "function_call" && itemType !== "custom_tool_call") {
					break;
				}
				const outputIndex = numberAt(payload, "output_index") ?? 0;
				let toolIndex = this._toolIndexByOutput.get(outputIndex);
				const full = stringAt(item, "arguments") ?? stringAt(item, "input");
				if (toolIndex === undefined) {
					// 少数兼容上游只发 done、不发 added；不能把整个工具调用丢掉。
					const name = stringAt(item, "name");
					if (name === undefined || name.length === 0) {
						break;
					}
					toolIndex = this._nextToolIndex++;
					this._sawToolCall = true;
					this._toolIndexByOutput.set(outputIndex, toolIndex);
					this._toolArguments.set(toolIndex, full ?? "");
					events.push({
						type: "tool_call_start",
						index: toolIndex,
						id: stringAt(item, "call_id", "id") ?? generateId("call"),
						name: name,
					});
					if (full !== undefined && full.length > 0) {
						events.push({ type: "tool_call_arguments", index: toolIndex, delta: full });
					}
				} else {
					const seen = this._toolArguments.get(toolIndex) ?? "";
					if (seen.length === 0 && full !== undefined && full.length > 0) {
						events.push({ type: "tool_call_arguments", index: toolIndex, delta: full });
					}
				}
				events.push({ type: "tool_call_stop", index: toolIndex });
				this._toolIndexByOutput.delete(outputIndex);
				break;
			}
			case "response.completed":
			case "response.incomplete": {
				const response = recordAt(payload, "response") ?? payload;
				const usage = recordAt(response, "usage");
				if (usage !== undefined) {
					events.push({ type: "usage", usage: usageFromResponses(usage) });
				}
				if (!this._finished) {
					this._finished = true;
					const status = stringAt(response, "status");
					const incomplete = type === "response.incomplete" || status === "incomplete";
					const incompleteReason = stringAt(recordAt(response, "incomplete_details"), "reason");
					let reason: CanonicalFinishReason = this._sawToolCall ? "tool_calls" : "stop";
					if (incomplete) {
						reason = incompleteReason === "content_filter" ? "content_filter" : "length";
					}
					events.push({ type: "finish", reason: reason });
				}
				break;
			}
			case "response.failed": {
				const response = recordAt(payload, "response");
				const error = recordAt(response, "error") ?? recordAt(payload, "error");
				events.push({
					type: "error",
					errorType: stringAt(error, "code", "type") ?? "upstream_error",
					message: stringAt(error, "message") ?? "上游流式响应失败",
				});
				break;
			}
			case "error":
			case "response.error": {
				const error = recordAt(payload, "error") ?? payload;
				events.push({
					type: "error",
					errorType: stringAt(error, "code", "type") ?? "upstream_error",
					message: stringAt(error, "message") ?? "上游流式响应失败",
				});
				break;
			}
			default:
				break;
		}
		return events;
	}
}

/** Responses 流内的正文项状态。 */
interface TextItemState {
	/** 输出项 ID。 */
	itemId: string;
	/** 输出位置。 */
	outputIndex: number;
	/** 内容索引。 */
	contentIndex: number;
	/** 已累计文本。 */
	text: string;
}

/** Responses 流内的思考项状态。 */
interface ReasoningItemState {
	/** 输出项 ID。 */
	itemId: string;
	/** 输出位置。 */
	outputIndex: number;
	/** 已累计文本。 */
	text: string;
	/** 签名。 */
	signature?: string;
}

/** Responses 流内的工具项状态。 */
interface ToolItemState {
	/** 输出项 ID。 */
	itemId: string;
	/** 输出位置。 */
	outputIndex: number;
	/** 调用 ID。 */
	callId: string;
	/** 工具名。 */
	name: string;
	/** 已累计参数。 */
	arguments: string;
	/** 是否已经输出 done 事件。 */
	closed: boolean;
}

/**
 * Responses SSE 编码器。
 */
export class ResponsesStreamEncoder implements CanonicalStreamEncoder {
	private readonly _options: CanonicalStreamOptions;
	private _responseId = "";
	private _model = "";
	private _createdAt = 0;
	private _sequence = 0;
	private _started = false;
	private _terminal = false;
	private _textItem: TextItemState | undefined;
	private _reasoningItem: ReasoningItemState | undefined;
	private readonly _toolItems = new Map<number, ToolItemState>();
	private readonly _closedToolIndexes = new Set<number>();
	private readonly _outputItems = new Map<number, Record<string, unknown>>();
	private _usage: CanonicalUsage | undefined;
	private _nextOutputIndex = 0;
	private _finishReason: CanonicalFinishReason | undefined;

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
			case "start": {
				this._responseId = toResponsesId(event.id);
				this._model = this._options.model;
				this._createdAt = event.createdAt;
				if (event.usage !== undefined) {
					this._usage = event.usage;
				}
				return this._startFrames();
			}
			case "text_delta": {
				const frames = [...this._startFrames(), ...this._ensureTextItem()];
				this._textItem!.text += event.text;
				frames.push(
					this._event("response.output_text.delta", {
						item_id: this._textItem!.itemId,
						output_index: this._textItem!.outputIndex,
						content_index: this._textItem!.contentIndex,
						delta: event.text,
						logprobs: [],
					}),
				);
				return frames;
			}
			case "refusal_delta": {
				const frames = [...this._startFrames(), ...this._ensureTextItem()];
				this._textItem!.text += event.text;
				frames.push(
					this._event("response.refusal.delta", {
						item_id: this._textItem!.itemId,
						output_index: this._textItem!.outputIndex,
						content_index: this._textItem!.contentIndex,
						delta: event.text,
					}),
				);
				return frames;
			}
			case "thinking_delta": {
				const frames = [...this._startFrames(), ...this._ensureReasoningItem()];
				this._reasoningItem!.text += event.text;
				frames.push(
					this._event("response.reasoning_summary_text.delta", {
						item_id: this._reasoningItem!.itemId,
						output_index: this._reasoningItem!.outputIndex,
						summary_index: 0,
						delta: event.text,
					}),
				);
				return frames;
			}
			case "thinking_signature": {
				const frames = [...this._startFrames(), ...this._ensureReasoningItem()];
				this._reasoningItem!.signature = `${this._reasoningItem!.signature ?? ""}${event.signature}`;
				return frames;
			}
			case "tool_call_start": {
				const frames = [...this._startFrames(), ...this._closeReasoningItem(), ...this._closeTextItem()];
				const outputIndex = this._nextOutputIndex++;
				const itemId = `${this._responseId}_function_${outputIndex}`;
				const state: ToolItemState = {
					itemId: itemId,
					outputIndex: outputIndex,
					callId: event.id,
					name: event.name,
					arguments: "",
					closed: false,
				};
				this._toolItems.set(event.index, state);
				this._outputItems.set(outputIndex, {
					id: itemId,
					type: "function_call",
					status: "in_progress",
					call_id: event.id,
					name: event.name,
					arguments: "",
				});
				frames.push(
					this._event("response.output_item.added", {
						output_index: outputIndex,
						item: {
							id: itemId,
							type: "function_call",
							status: "in_progress",
							call_id: event.id,
							name: event.name,
							arguments: "",
						},
					}),
				);
				return frames;
			}
			case "tool_call_arguments": {
				const state = this._toolItems.get(event.index);
				if (state === undefined) {
					return [];
				}
				state.arguments += event.delta;
				return [
					this._event("response.function_call_arguments.delta", {
						item_id: state.itemId,
						output_index: state.outputIndex,
						delta: event.delta,
					}),
				];
			}
			case "tool_call_stop": {
				const state = this._toolItems.get(event.index);
				if (state === undefined || this._closedToolIndexes.has(event.index)) {
					return [];
				}
				this._closedToolIndexes.add(event.index);
				this._outputItems.set(state.outputIndex, {
					id: state.itemId,
					type: "function_call",
					status: "completed",
					call_id: state.callId,
					name: state.name,
					arguments: state.arguments,
				});
				return [
					this._event("response.function_call_arguments.done", {
						item_id: state.itemId,
						output_index: state.outputIndex,
						arguments: state.arguments,
					}),
					this._event("response.output_item.done", {
						output_index: state.outputIndex,
						item: {
							id: state.itemId,
							type: "function_call",
							status: "completed",
							call_id: state.callId,
							name: state.name,
							arguments: state.arguments,
						},
					}),
				];
			}
			case "usage": {
				this._usage = event.usage;
				return [];
			}
			case "finish": {
				if (this._finishReason !== undefined) {
					return [];
				}
				this._finishReason = event.reason;
				const frames = [...this._startFrames()];
				frames.push(...this._closeReasoningItem());
				frames.push(...this._closeTextItem());
				for (const index of this._toolItems.keys()) {
					frames.push(...this._closeToolItem(index));
				}
				// 终止帧延迟到 flush，等待可能紧随其后的 usage 分片。
				return frames;
			}
			case "error": {
				const frames = [...this._startFrames()];
				frames.push(...this._closeReasoningItem());
				frames.push(...this._closeTextItem());
				frames.push(
					this._event("response.failed", {
						response: this._responseObject("failed", { code: event.errorType, message: event.message }),
					}),
				);
				this._terminal = true;
				return frames;
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
		const frames = [...this._startFrames()];
		frames.push(...this._closeReasoningItem());
		frames.push(...this._closeTextItem());
		for (const index of this._toolItems.keys()) {
			frames.push(...this._closeToolItem(index));
		}
		frames.push(this._terminalFrame(this._finishReason ?? "stop"));
		this._terminal = true;
		return frames;
	}

	private _ensureIdentity(): void {
		if (this._responseId.length === 0) {
			this._responseId = generateId("resp");
		}
		if (this._model.length === 0) {
			this._model = this._options.model;
		}
		if (this._createdAt === 0) {
			this._createdAt = Math.floor(Date.now() / 1000);
		}
	}

	private _startFrames(): ProtocolEvent[] {
		if (this._started) {
			return [];
		}
		this._started = true;
		this._ensureIdentity();
		return [
			this._event("response.created", {
				response: this._responseObject("in_progress", null),
			}),
			this._event("response.in_progress", {
				response: this._responseObject("in_progress", null),
			}),
		];
	}

	private _event(type: string, payload: Record<string, unknown>): ProtocolEvent {
		return {
			event: type,
			data: { type: type, sequence_number: this._sequence++, ...payload },
		};
	}

	private _ensureTextItem(): ProtocolEvent[] {
		if (this._textItem !== undefined) {
			return [];
		}
		const outputIndex = this._nextOutputIndex++;
		const itemId = `${this._responseId}_message_${outputIndex}`;
		this._textItem = { itemId: itemId, outputIndex: outputIndex, contentIndex: 0, text: "" };
		this._outputItems.set(outputIndex, {
			id: itemId,
			type: "message",
			status: "in_progress",
			role: "assistant",
			content: [],
		});
		return [
			this._event("response.output_item.added", {
				output_index: outputIndex,
				item: {
					id: itemId,
					type: "message",
					status: "in_progress",
					role: "assistant",
					content: [],
				},
			}),
			this._event("response.content_part.added", {
				item_id: itemId,
				output_index: outputIndex,
				content_index: 0,
				part: { type: "output_text", annotations: [], logprobs: [], text: "" },
			}),
		];
	}

	private _closeTextItem(): ProtocolEvent[] {
		const item = this._textItem;
		if (item === undefined) {
			return [];
		}
		this._textItem = undefined;
		this._outputItems.set(item.outputIndex, {
			id: item.itemId,
			type: "message",
			status: "completed",
			role: "assistant",
			content: [{ type: "output_text", annotations: [], logprobs: [], text: item.text }],
		});
		return [
			this._event("response.output_text.done", {
				item_id: item.itemId,
				output_index: item.outputIndex,
				content_index: item.contentIndex,
				text: item.text,
				logprobs: [],
			}),
			this._event("response.content_part.done", {
				item_id: item.itemId,
				output_index: item.outputIndex,
				content_index: item.contentIndex,
				part: { type: "output_text", annotations: [], logprobs: [], text: item.text },
			}),
			this._event("response.output_item.done", {
				output_index: item.outputIndex,
				item: {
					id: item.itemId,
					type: "message",
					status: "completed",
					role: "assistant",
					content: [
						{ type: "output_text", annotations: [], logprobs: [], text: item.text },
					],
				},
			}),
		];
	}

	private _ensureReasoningItem(): ProtocolEvent[] {
		if (this._reasoningItem !== undefined) {
			return [];
		}
		const outputIndex = this._nextOutputIndex++;
		const itemId = `${this._responseId}_reasoning_${outputIndex}`;
		this._reasoningItem = { itemId: itemId, outputIndex: outputIndex, text: "" };
		this._outputItems.set(outputIndex, {
			id: itemId,
			type: "reasoning",
			status: "in_progress",
			summary: [],
		});
		return [
			this._event("response.output_item.added", {
				output_index: outputIndex,
				item: {
					id: itemId,
					type: "reasoning",
					status: "in_progress",
					summary: [],
				},
			}),
			this._event("response.reasoning_summary_part.added", {
				item_id: itemId,
				output_index: outputIndex,
				summary_index: 0,
				part: { type: "summary_text", text: "" },
			}),
		];
	}

	private _closeReasoningItem(): ProtocolEvent[] {
		const item = this._reasoningItem;
		if (item === undefined) {
			return [];
		}
		this._reasoningItem = undefined;
		this._outputItems.set(item.outputIndex, {
			id: item.itemId,
			type: "reasoning",
			status: "completed",
			summary: [{ type: "summary_text", text: item.text }],
			...(item.signature === undefined ? {} : { encrypted_content: item.signature }),
		});
		return [
			this._event("response.reasoning_summary_text.done", {
				item_id: item.itemId,
				output_index: item.outputIndex,
				summary_index: 0,
				text: item.text,
			}),
			this._event("response.reasoning_summary_part.done", {
				item_id: item.itemId,
				output_index: item.outputIndex,
				summary_index: 0,
				part: { type: "summary_text", text: item.text },
			}),
			this._event("response.output_item.done", {
				output_index: item.outputIndex,
				item: {
					id: item.itemId,
					type: "reasoning",
					status: "completed",
					summary: [{ type: "summary_text", text: item.text }],
					...(item.signature === undefined ? {} : { encrypted_content: item.signature }),
				},
			}),
		];
	}

	private _closeToolItem(index: number): ProtocolEvent[] {
		const state = this._toolItems.get(index);
		if (state === undefined || this._closedToolIndexes.has(index)) {
			return [];
		}
		this._closedToolIndexes.add(index);
		state.closed = true;
		this._outputItems.set(state.outputIndex, {
			id: state.itemId,
			type: "function_call",
			status: "completed",
			call_id: state.callId,
			name: state.name,
			arguments: state.arguments,
		});
		return [
			this._event("response.function_call_arguments.done", {
				item_id: state.itemId,
				output_index: state.outputIndex,
				arguments: state.arguments,
			}),
			this._event("response.output_item.done", {
				output_index: state.outputIndex,
				item: {
					id: state.itemId,
					type: "function_call",
					status: "completed",
					call_id: state.callId,
					name: state.name,
					arguments: state.arguments,
				},
			}),
		];
	}

	private _terminalFrame(reason: CanonicalFinishReason): ProtocolEvent {
		this._ensureIdentity();
		const status = reason === "length" || reason === "content_filter" ? "incomplete" : "completed";
		const type = status === "incomplete" ? "response.incomplete" : "response.completed";
		return this._event(type, {
			response: this._responseObject(status, null),
		});
	}

	private _responseObject(status: string, error: Record<string, unknown> | null): Record<string, unknown> {
		const output = [...this._outputItems.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, item]) => item);
		return {
			id: this._responseId,
			object: "response",
			created_at: this._createdAt,
			completed_at: status === "completed" ? Math.floor(Date.now() / 1000) : null,
			status: status,
			error: error,
			incomplete_details:
				status === "incomplete" ? { reason: "max_output_tokens" } : null,
			instructions: null,
			model: this._model,
			output: output,
			parallel_tool_calls: true,
			previous_response_id: null,
			reasoning: { effort: null, summary: null },
			store: false,
			temperature: 1,
			text: { format: { type: "text" } },
			tool_choice: "auto",
			tools: [],
			top_p: 1,
			truncation: "disabled",
			usage: this._usage === undefined ? null : responsesUsage(this._usage),
			user: null,
			metadata: {},
		};
	}
}

/**
 * 创建 Responses 流解码器。
 * @param options - 流式选项
 */
export function createResponsesStreamDecoder(options: CanonicalStreamOptions): CanonicalStreamDecoder {
	return new ResponsesStreamDecoder(options);
}

/**
 * 创建 Responses 流编码器。
 * @param options - 流式选项
 */
export function createResponsesStreamEncoder(options: CanonicalStreamOptions): CanonicalStreamEncoder {
	return new ResponsesStreamEncoder(options);
}
