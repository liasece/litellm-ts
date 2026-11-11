/**
 * Anthropic Messages 协议的请求、响应与流式事件编解码。
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
	anthropicUsage,
	asRecord,
	asRecordArray,
	booleanAt,
	cacheControlFrom,
	cacheControlTo,
	effortToBudget,
	finishFromAnthropic,
	finishToAnthropic,
	generateId,
	mergeAdjacentText,
	mergeUsage,
	normalizeStopList,
	numberAt,
	parseArgumentsObject,
	recordAt,
	sanitizeToolId,
	stringAt,
	stringifyArguments,
	toAnthropicId,
	usageFromAnthropic,
} from "./shared";

/** 默认 max_tokens；Anthropic 要求必填。 */
const DEFAULT_MAX_TOKENS = 32000;

/**
 * 解码 Anthropic 内容块数组。
 * @param content - content 字段
 */
function decodeAnthropicBlocks(content: unknown): CanonicalContentPart[] {
	if (typeof content === "string") {
		return content.length === 0 ? [] : [{ type: "text", text: content }];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: CanonicalContentPart[] = [];
	for (const raw of content) {
		if (typeof raw === "string") {
			if (raw.length > 0) {
				parts.push({ type: "text", text: raw });
			}
			continue;
		}
		const block = asRecord(raw);
		if (!block) {
			continue;
		}
		const cacheControl = cacheControlFrom(block);
		const type = stringAt(block, "type") ?? "text";
		switch (type) {
			case "text": {
				const text = stringAt(block, "text") ?? "";
				if (text.length > 0 || cacheControl !== undefined) {
					parts.push({
						type: "text",
						text: text,
						...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
					});
				}
				break;
			}
			case "image": {
				const source = recordAt(block, "source") ?? {};
				const sourceType = stringAt(source, "type");
				if (sourceType === "base64") {
					const mediaType = stringAt(source, "media_type") ?? "image/png";
					const data = stringAt(source, "data") ?? "";
					parts.push({
						type: "image",
						url: `data:${mediaType};base64,${data}`,
						...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
					});
				} else if (sourceType === "url") {
					const url = stringAt(source, "url");
					if (url !== undefined) {
						parts.push({
							type: "image",
							url: url,
							...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
						});
					}
				} else if (sourceType === "file") {
					const fileId = stringAt(source, "file_id");
					if (fileId !== undefined) {
						parts.push({ type: "document", fileId: fileId });
					}
				}
				break;
			}
			case "document": {
				const source = recordAt(block, "source") ?? {};
				const sourceType = stringAt(source, "type");
				const title = stringAt(block, "title");
				if (sourceType === "base64") {
					const mediaType = stringAt(source, "media_type") ?? "application/pdf";
					const data = stringAt(source, "data") ?? "";
					parts.push({
						type: "document",
						url: `data:${mediaType};base64,${data}`,
						mediaType: mediaType,
						...(title === undefined ? {} : { title: title }),
					});
				} else if (sourceType === "text") {
					parts.push({
						type: "document",
						text: stringAt(source, "data") ?? "",
						mediaType: stringAt(source, "media_type") ?? "text/plain",
						...(title === undefined ? {} : { title: title }),
					});
				} else if (sourceType === "url") {
					const url = stringAt(source, "url");
					if (url !== undefined) {
						parts.push({
							type: "document",
							url: url,
							...(title === undefined ? {} : { title: title }),
						});
					}
				}
				break;
			}
			case "tool_use": {
				parts.push({
					type: "tool_call",
					id: stringAt(block, "id") ?? generateId("toolu"),
					name: stringAt(block, "name") ?? "",
					arguments: stringifyArguments(block["input"]),
				});
				break;
			}
			case "tool_result": {
				const content = decodeAnthropicBlocks(block["content"]);
				parts.push({
					type: "tool_result",
					toolCallId: stringAt(block, "tool_use_id") ?? "",
					content: content.length > 0 ? content : [{ type: "text", text: "" }],
					...(booleanAt(block, "is_error") === undefined ? {} : { isError: booleanAt(block, "is_error") }),
					...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
				});
				break;
			}
			case "thinking": {
				parts.push({
					type: "thinking",
					text: stringAt(block, "thinking") ?? "",
					...(stringAt(block, "signature") === undefined
						? {}
						: { signature: stringAt(block, "signature") }),
				});
				break;
			}
			case "redacted_thinking": {
				parts.push({
					type: "thinking",
					text: "",
					signature: stringAt(block, "data") ?? "",
					redacted: true,
				});
				break;
			}
			default: {
				const text = stringAt(block, "text");
				if (text !== undefined && text.length > 0) {
					parts.push({ type: "text", text: text });
				}
			}
		}
	}
	return parts;
}

/**
 * 解码 Messages 工具定义。
 * @param value - tools 字段
 */
export function decodeMessagesTools(value: unknown): CanonicalTool[] {
	const tools: CanonicalTool[] = [];
	for (const raw of asRecordArray(value)) {
		const name = stringAt(raw, "name");
		if (name === undefined || name.length === 0) {
			continue;
		}
		const description = stringAt(raw, "description");
		const parameters = recordAt(raw, "input_schema", "parameters");
		const strict = booleanAt(raw, "strict");
		const cacheControl = cacheControlFrom(raw);
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
 * 解码 Messages 工具选择。
 * @param value - tool_choice 字段
 */
export function decodeMessagesToolChoice(value: unknown): CanonicalToolChoice | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const type = stringAt(record, "type");
	const disableParallel = booleanAt(record, "disable_parallel_tool_use");
	const base = disableParallel === undefined ? {} : { disableParallelToolUse: disableParallel };
	switch (type) {
		case "auto":
			return { mode: "auto", ...base };
		case "none":
			return { mode: "none", ...base };
		case "any":
		case "required":
			return { mode: "required", ...base };
		case "tool": {
			const name = stringAt(record, "name");
			return name === undefined ? { mode: "required", ...base } : { mode: "tool", name: name, ...base };
		}
		case "allowed_tools": {
			const names: string[] = [];
			for (const tool of asRecordArray(record["tools"])) {
				const name = stringAt(tool, "name");
				if (name !== undefined) {
					names.push(name);
				}
			}
			const mode = stringAt(record, "mode");
			return {
				mode: mode === "required" || mode === "any" ? "required" : "auto",
				...(names.length === 0 ? {} : { allowedNames: names }),
				...base,
			};
		}
		default:
			return undefined;
	}
}

/**
 * 解码 Messages 结构化输出配置。
 * @param value - output_config.format 字段
 */
export function decodeMessagesResponseFormat(value: unknown): CanonicalResponseFormat | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const type = stringAt(record, "type");
	if (type === "json_schema") {
		const schema = record["schema"];
		return { type: "json_schema", ...(schema === undefined ? {} : { schema: schema }) };
	}
	if (type === "json_object") {
		return { type: "json_object" };
	}
	return undefined;
}

/**
 * 解码 Messages 请求。
 * @param body - Messages 请求体
 * @param fallbackModel - 请求体缺少 model 时使用
 */
export function decodeMessagesRequest(body: Record<string, unknown>, fallbackModel: string): CanonicalRequest {
	const system = decodeAnthropicBlocks(body["system"]);
	const messages: CanonicalMessage[] = [];
	for (const raw of asRecordArray(body["messages"])) {
		const role = stringAt(raw, "role");
		const parts = decodeAnthropicBlocks(raw["content"]);
		if (parts.length === 0) {
			continue;
		}
		const cacheControl = cacheControlFrom(raw);
		const resolvedRole = role === "assistant" ? "assistant" : role === "tool" ? "tool" : "user";
		messages.push({
			role: resolvedRole,
			parts: parts,
			...(cacheControl === undefined ? {} : { cacheControl: cacheControl }),
		});
	}
	const thinking = recordAt(body, "thinking");
	const thinkingType = stringAt(thinking, "type");
	const budgetTokens = numberAt(thinking, "budget_tokens");
	const outputConfig = recordAt(body, "output_config");
	const effort = stringAt(outputConfig, "effort");
	const extras: CanonicalRequestExtras = {
		...(stringAt(recordAt(body, "metadata"), "user_id") === undefined
			? {}
			: { user: stringAt(recordAt(body, "metadata"), "user_id") }),
		...(stringAt(body, "service_tier") === undefined ? {} : { serviceTier: stringAt(body, "service_tier") }),
	};
	const maxTokens = numberAt(body, "max_tokens");
	const responseFormat = decodeMessagesResponseFormat(outputConfig?.["format"]);
	const toolChoice = decodeMessagesToolChoice(body["tool_choice"]);
	return {
		model: stringAt(body, "model") ?? fallbackModel,
		system: system,
		messages: messages,
		tools: decodeMessagesTools(body["tools"]),
		...(toolChoice === undefined ? {} : { toolChoice: toolChoice }),
		...(maxTokens === undefined ? {} : { maxTokens: maxTokens }),
		...(numberAt(body, "temperature") === undefined ? {} : { temperature: numberAt(body, "temperature") }),
		...(numberAt(body, "top_p") === undefined ? {} : { topP: numberAt(body, "top_p") }),
		...(numberAt(body, "top_k") === undefined ? {} : { topK: numberAt(body, "top_k") }),
		stop: normalizeStopList(body["stop_sequences"]),
		...(booleanAt(body, "stream") === undefined ? {} : { stream: booleanAt(body, "stream") }),
		...(recordAt(body, "metadata") === undefined ? {} : { metadata: recordAt(body, "metadata") }),
		...(thinkingType === undefined && budgetTokens === undefined && effort === undefined
			? {}
			: {
					reasoning: {
						...(thinkingType === "disabled" ? { enabled: false } : {}),
						...(thinkingType === "enabled" || thinkingType === "adaptive" || budgetTokens !== undefined
							? { enabled: true }
							: {}),
						...(budgetTokens === undefined ? {} : { budgetTokens: budgetTokens }),
						...(effort === undefined ? {} : { effort: effort.toLowerCase() }),
					},
				}),
		...(responseFormat === undefined ? {} : { responseFormat: responseFormat }),
		extras: extras,
	};
}

/**
 * 编码文本块。
 * @param text - 文本
 * @param cacheControl - 缓存标记
 */
function encodeTextBlock(text: string, cacheControl: ReturnType<typeof cacheControlTo>): Record<string, unknown> {
	return {
		type: "text",
		text: text,
		...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
	};
}

/**
 * 编码图片/文档块。
 * @param part - 图片或文档片段
 */
function encodeMediaBlock(part: CanonicalContentPart): Record<string, unknown> | undefined {
	if (part.type === "image") {
		const cacheControl = cacheControlTo(part.cacheControl);
		const prefix = part.url.slice(0, part.url.indexOf(","));
		const isBase64 = part.url.startsWith("data:") && prefix.endsWith(";base64");
		if (isBase64) {
			const comma = part.url.indexOf(",");
			const mediaType = part.url.slice(5, prefix.length - 7) || "image/png";
			return {
				type: "image",
				source: { type: "base64", media_type: mediaType, data: part.url.slice(comma + 1) },
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			};
		}
		if (part.url.startsWith("data:")) {
			const comma = part.url.indexOf(",");
			const mediaType = part.url.slice(5, comma).split(";")[0] || "image/png";
			return {
				type: "image",
				source: { type: "base64", media_type: mediaType, data: part.url.slice(comma + 1) },
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			};
		}
		return {
			type: "image",
			source: { type: "url", url: part.url },
			...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
		};
	}
	if (part.type === "document") {
		const cacheControl = cacheControlTo(part.cacheControl);
		const title = part.title === undefined ? {} : { title: part.title };
		if (part.fileId !== undefined) {
			return {
				type: "document",
				source: { type: "file", file_id: part.fileId },
				...title,
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			};
		}
		if (part.text !== undefined) {
			return {
				type: "document",
				source: { type: "text", media_type: part.mediaType ?? "text/plain", data: part.text },
				...title,
				...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
			};
		}
		if (part.url !== undefined) {
			if (part.url.startsWith("data:")) {
				const comma = part.url.indexOf(",");
				const header = part.url.slice(5, comma);
				const mediaType = header.endsWith(";base64") ? header.slice(0, -7) : header.split(";")[0] ?? "application/pdf";
				return {
					type: "document",
					source: { type: "base64", media_type: mediaType, data: part.url.slice(comma + 1) },
					...title,
					...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
				};
			}
			return { type: "document", source: { type: "url", url: part.url }, ...title };
		}
	}
	return undefined;
}

/**
 * 编码一条规范消息的内容块。
 * @param message - 规范消息
 * @param seenToolIds - 已出现的工具调用 ID
 * @param emittedToolResults - 已输出的工具结果 ID
 */
function encodeMessagesBlocks(
	message: CanonicalMessage,
	seenToolIds: ReadonlySet<string>,
	emittedToolResults: Set<string>,
): Record<string, unknown>[] {
	const blocks: Record<string, unknown>[] = [];
	for (const part of mergeAdjacentText(message.parts)) {
		switch (part.type) {
			case "text": {
				const cacheControl = cacheControlTo(part.cacheControl ?? message.cacheControl);
				blocks.push(encodeTextBlock(part.text, cacheControl));
				break;
			}
			case "image":
			case "document": {
				const block = encodeMediaBlock(part);
				if (block) {
					blocks.push(block);
				}
				break;
			}
			case "thinking": {
				if (message.role !== "assistant") {
					break;
				}
				if (part.redacted) {
					blocks.push({ type: "redacted_thinking", data: part.signature ?? "" });
					break;
				}
				if (part.text.length === 0) {
					break;
				}
				// 编码层保留 thinking 文本；Claude 目标会在 Provider 边界删除无签名
				// 或外来签名的块，Kimi 目标则可保留文本并丢弃签名。
				blocks.push({
					type: "thinking",
					thinking: part.text,
					...(part.signature === undefined || part.signature.length === 0
						? {}
						: { signature: part.signature }),
				});
				break;
			}
			case "refusal": {
				blocks.push(encodeTextBlock(part.text, cacheControlTo(message.cacheControl)));
				break;
			}
			case "tool_call": {
				if (message.role !== "assistant") {
					break;
				}
				blocks.push({
					type: "tool_use",
					id: sanitizeToolId(part.id),
					name: part.name,
					input: parseArgumentsObject(part.arguments),
				});
				break;
			}
			case "tool_result": {
				if (emittedToolResults.has(part.toolCallId)) {
					break;
				}
				const paired = seenToolIds.has(part.toolCallId);
				const content: readonly CanonicalContentPart[] =
					part.content.length > 0 ? part.content : [{ type: "text", text: "" }];
				if (!paired) {
					// Anthropic 拒绝孤立 tool_result；退化为普通用户文本。
					for (const item of content) {
						if (item.type === "text") {
							blocks.push(encodeTextBlock(item.text, undefined));
						} else {
							const block = encodeMediaBlock(item);
							if (block) {
								blocks.push(block);
							}
						}
					}
					break;
				}
				emittedToolResults.add(part.toolCallId);
				const cacheControl = cacheControlTo(part.cacheControl ?? message.cacheControl);
				const textOnly = content.every((item) => item.type === "text");
				const textContent = content
					.filter((item) => item.type === "text")
					.map((item) => (item.type === "text" ? item.text : ""))
					.join("");
				if (textOnly) {
					blocks.push({
						type: "tool_result",
						tool_use_id: sanitizeToolId(part.toolCallId),
						content: textContent,
						...(part.isError === true ? { is_error: true } : {}),
						...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
					});
					break;
				}
				const nested: Record<string, unknown>[] = [];
				for (const item of content) {
					if (item.type === "text") {
						nested.push(encodeTextBlock(item.text, undefined));
					} else {
						const block = encodeMediaBlock(item);
						if (block) {
							nested.push(block);
						}
					}
				}
				blocks.push({
					type: "tool_result",
					tool_use_id: sanitizeToolId(part.toolCallId),
					content: nested,
					...(part.isError === true ? { is_error: true } : {}),
					...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
				});
				break;
			}
			default:
				break;
		}
	}
	return blocks;
}

/**
 * 编码 Messages 工具定义。
 * @param tools - 规范工具
 */
function encodeMessagesTools(tools: readonly CanonicalTool[]): Record<string, unknown>[] {
	return tools.map((tool) => {
		const cacheControl = cacheControlTo(tool.cacheControl);
		return {
			name: tool.name,
			...(tool.description === undefined ? {} : { description: tool.description }),
			input_schema:
				tool.parameters === undefined
					? { type: "object", properties: {} }
					: tool.parameters,
			...(tool.strict === undefined ? {} : { strict: tool.strict }),
			...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
		};
	});
}

/**
 * 编码 Messages 工具选择。
 * @param choice - 规范工具选择
 */
function encodeMessagesToolChoice(choice: CanonicalToolChoice | undefined): Record<string, unknown> | undefined {
	if (!choice) {
		return undefined;
	}
	const disable = choice.disableParallelToolUse === true ? { disable_parallel_tool_use: true } : {};
	switch (choice.mode) {
		case "none":
			return { type: "none", ...disable };
		case "required":
			return { type: "any", ...disable };
		case "tool":
			return choice.name === undefined ? { type: "any", ...disable } : { type: "tool", name: choice.name, ...disable };
		default:
			return { type: "auto", ...disable };
	}
}

/**
 * 生成结构化输出系统提示。
 * @param format - 规范输出格式
 */
function structuredOutputInstruction(format: CanonicalResponseFormat | undefined): string | undefined {
	if (!format || format.type === "text") {
		return undefined;
	}
	if (format.type === "json_object") {
		return "Respond only with a single valid JSON object.";
	}
	const schema = format.schema === undefined ? "{}" : JSON.stringify(format.schema);
	return `Respond only with valid JSON that conforms to this JSON schema:\n${schema}`;
}

/**
 * 编码 Messages 请求。
 * @param request - 规范请求
 * @param upstreamModel - 上游模型 ID
 */
export function encodeMessagesRequest(request: CanonicalRequest, upstreamModel: string): Record<string, unknown> {
	const systemBlocks: Record<string, unknown>[] = [];
	for (const part of request.system) {
		if (part.type === "text" && part.text.length > 0) {
			systemBlocks.push(encodeTextBlock(part.text, cacheControlTo(part.cacheControl)));
		} else if (part.type === "image" || part.type === "document") {
			const block = encodeMediaBlock(part);
			if (block) {
				systemBlocks.push(block);
			}
		}
	}
	for (const message of request.messages) {
		if (message.role === "system") {
			for (const part of message.parts) {
				if (part.type === "text" && part.text.length > 0) {
					systemBlocks.push(encodeTextBlock(part.text, cacheControlTo(part.cacheControl ?? message.cacheControl)));
				}
			}
		}
	}
	const instruction = structuredOutputInstruction(request.responseFormat);
	if (instruction !== undefined) {
		systemBlocks.push(encodeTextBlock(instruction, undefined));
	}
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
	const messages: Record<string, unknown>[] = [];
	const emittedToolResults = new Set<string>();
	for (const message of request.messages) {
		if (message.role === "system") {
			continue;
		}
		const role = message.role === "assistant" ? "assistant" : "user";
		const blocks = encodeMessagesBlocks(message, seenToolIds, emittedToolResults);
		if (blocks.length === 0) {
			continue;
		}
		const previous = messages.at(-1);
		if (previous !== undefined && previous["role"] === role && Array.isArray(previous["content"])) {
			previous["content"] = [...(previous["content"] as unknown[]), ...blocks];
			continue;
		}
		messages.push({
			role: role,
			content: blocks,
			...(message.cacheControl === undefined ? {} : { cache_control: cacheControlTo(message.cacheControl) }),
		});
	}
	if (messages.length === 0) {
		messages.push({ role: "user", content: [encodeTextBlock("", undefined)] });
	}
	const body: Record<string, unknown> = {
		model: upstreamModel,
		max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
		messages: messages,
	};
	const systemContent =
		systemBlocks.length === 1 &&
		stringAt(systemBlocks[0], "type") === "text" &&
		asRecord(systemBlocks[0])?.["cache_control"] === undefined
			? stringAt(systemBlocks[0], "text")
			: systemBlocks;
	if (systemBlocks.length > 0) {
		body["system"] = systemContent;
	}
	if (request.tools.length > 0) {
		body["tools"] = encodeMessagesTools(request.tools);
	}
	const toolChoice = encodeMessagesToolChoice(request.toolChoice);
	if (toolChoice !== undefined) {
		body["tool_choice"] = toolChoice;
	} else if (request.parallelToolCalls === false && request.tools.length > 0) {
		body["tool_choice"] = { type: "auto", disable_parallel_tool_use: true };
	}
	if (request.stop.length > 0) {
		body["stop_sequences"] = [...request.stop];
	}
	body["stream"] = request.stream === true;
	const userId = stringAt(request.metadata, "user_id") ?? request.extras.user;
	if (userId !== undefined) {
		body["metadata"] = { user_id: userId };
	}
	const reasoning = request.reasoning;
	const thinkingEnabled =
		reasoning !== undefined &&
		reasoning.enabled !== false &&
		(reasoning.enabled === true || reasoning.budgetTokens !== undefined || reasoning.effort !== undefined);
	if (reasoning?.enabled === false) {
		body["thinking"] = { type: "disabled" };
		if (request.temperature !== undefined) {
			body["temperature"] = request.temperature;
		}
		if (request.topP !== undefined) {
			body["top_p"] = request.topP;
		}
	} else if (thinkingEnabled && reasoning !== undefined) {
		const budget =
			reasoning.budgetTokens ??
			(reasoning.effort === undefined ? undefined : effortToBudget(reasoning.effort)) ??
			8192;
		const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
		const safeBudget = Math.min(
			Math.max(budget, 1024),
			Math.max(1024, maxTokens - 1024),
		);
		body["thinking"] = { type: "enabled", budget_tokens: safeBudget };
		if (safeBudget + 1024 > maxTokens) {
			body["max_tokens"] = safeBudget + 1024;
		}
	} else {
		if (request.temperature !== undefined) {
			body["temperature"] = request.temperature;
		}
		if (request.topP !== undefined) {
			body["top_p"] = request.topP;
		}
	}
	if (request.topK !== undefined) {
		body["top_k"] = request.topK;
	}
	return body;
}

/**
 * 解码 Messages 响应。
 * @param body - Messages 响应体
 * @param fallbackModel - 响应缺少 model 时使用
 */
export function decodeMessagesResponse(body: Record<string, unknown>, fallbackModel: string): CanonicalResponse {
	const parts = decodeAnthropicBlocks(body["content"]);
	const hasToolCalls = parts.some((part) => part.type === "tool_call");
	const baseFinish = finishFromAnthropic(stringAt(body, "stop_reason"));
	const finishReason: CanonicalFinishReason =
		baseFinish === "length" || baseFinish === "content_filter"
			? baseFinish
			: hasToolCalls
				? "tool_calls"
				: baseFinish;
	return {
		id: stringAt(body, "id") ?? generateId("msg"),
		createdAt: Math.floor(Date.now() / 1000),
		model: stringAt(body, "model") ?? fallbackModel,
		parts: parts,
		finishReason: finishReason,
		...(stringAt(body, "stop_sequence") === undefined
			? {}
			: { stopSequence: stringAt(body, "stop_sequence") }),
		usage: usageFromAnthropic(recordAt(body, "usage")),
	};
}

/**
 * 编码 Messages 响应。
 * @param response - 规范响应
 * @param model - 对外模型 ID
 */
export function encodeMessagesResponse(response: CanonicalResponse, model: string): Record<string, unknown> {
	const content: Record<string, unknown>[] = [];
	for (const part of mergeAdjacentText(response.parts)) {
		switch (part.type) {
			case "text": {
				content.push(encodeTextBlock(part.text, undefined));
				break;
			}
			case "thinking": {
				if (part.redacted) {
					content.push({ type: "redacted_thinking", data: part.signature ?? "" });
				} else if (part.text.length > 0) {
					content.push({
						type: "thinking",
						thinking: part.text,
						...(part.signature === undefined ? {} : { signature: part.signature }),
					});
				}
				break;
			}
			case "refusal": {
				content.push(encodeTextBlock(part.text, undefined));
				break;
			}
			case "tool_call": {
				content.push({
					type: "tool_use",
					id: sanitizeToolId(part.id),
					name: part.name,
					input: parseArgumentsObject(part.arguments),
				});
				break;
			}
			case "image":
			case "document": {
				const block = encodeMediaBlock(part);
				if (block) {
					content.push(block);
				}
				break;
			}
			case "tool_result": {
				break;
			}
			default:
				break;
		}
	}
	return {
		id: toAnthropicId(response.id),
		type: "message",
		role: "assistant",
		model: model,
		content: content,
		stop_reason: finishToAnthropic(response.finishReason, content.some((block) => block["type"] === "tool_use")),
		stop_sequence: response.stopSequence ?? null,
		usage: anthropicUsage(response.usage),
	};
}

/**
 * Messages SSE 解码器。
 */
export class MessagesStreamDecoder implements CanonicalStreamDecoder {
	private readonly _options: CanonicalStreamOptions;
	private readonly _toolIndexByBlock = new Map<number, number>();
	private readonly _blockTypes = new Map<number, "text" | "thinking" | "tool">();
	private _nextToolIndex = 0;
	private _sawToolCall = false;
	private _started = false;
	private _finished = false;
	private _usage: CanonicalUsage | undefined;

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
			case "message_start": {
				if (this._started) {
					break;
				}
				this._started = true;
				const message = recordAt(payload, "message");
				const usage = recordAt(message, "usage");
				if (usage !== undefined) {
					this._usage = mergeUsage(this._usage, usageFromAnthropic(usage));
				}
				events.push({
					type: "start",
					id: stringAt(message, "id") ?? generateId("msg"),
					model: stringAt(message, "model") ?? this._options.upstreamModel,
					createdAt: Math.floor(Date.now() / 1000),
					...(this._usage === undefined ? {} : { usage: this._usage }),
				});
				if (this._usage !== undefined) {
					events.push({ type: "usage", usage: this._usage });
				}
				break;
			}
			case "content_block_start": {
				const index = numberAt(payload, "index") ?? 0;
				const block = recordAt(payload, "content_block") ?? {};
				const blockType = stringAt(block, "type");
				if (blockType === "tool_use") {
					this._sawToolCall = true;
					const toolIndex = this._nextToolIndex++;
					this._toolIndexByBlock.set(index, toolIndex);
					this._blockTypes.set(index, "tool");
					events.push({
						type: "tool_call_start",
						index: toolIndex,
						id: stringAt(block, "id") ?? generateId("toolu"),
						name: stringAt(block, "name") ?? "",
					});
					const input = block["input"];
					if (input !== null && typeof input === "object" && Object.keys(input).length > 0) {
						events.push({
							type: "tool_call_arguments",
							index: toolIndex,
							delta: JSON.stringify(input),
						});
					}
					break;
				}
				const startText = stringAt(block, "text");
				if (startText !== undefined && startText.length > 0) {
					this._blockTypes.set(index, "text");
					events.push({ type: "text_delta", text: startText });
				} else if (blockType === "thinking") {
					this._blockTypes.set(index, "thinking");
					const thinking = stringAt(block, "thinking");
					if (thinking !== undefined && thinking.length > 0) {
						events.push({ type: "thinking_delta", text: thinking });
					}
					const signature = stringAt(block, "signature");
					if (signature !== undefined && signature.length > 0) {
						events.push({ type: "thinking_signature", signature: signature });
					}
				} else {
					this._blockTypes.set(index, "text");
				}
				break;
			}
			case "content_block_delta": {
				const index = numberAt(payload, "index") ?? 0;
				const delta = recordAt(payload, "delta") ?? {};
				const deltaType = stringAt(delta, "type");
				if (deltaType === "text_delta") {
					const text = stringAt(delta, "text");
					if (text !== undefined && text.length > 0) {
						events.push({ type: "text_delta", text: text });
					}
				} else if (deltaType === "thinking_delta") {
					const thinking = stringAt(delta, "thinking");
					if (thinking !== undefined && thinking.length > 0) {
						events.push({ type: "thinking_delta", text: thinking });
					}
				} else if (deltaType === "signature_delta") {
					const signature = stringAt(delta, "signature");
					if (signature !== undefined && signature.length > 0) {
						events.push({ type: "thinking_signature", signature: signature });
					}
				} else if (deltaType === "input_json_delta") {
					let toolIndex = this._toolIndexByBlock.get(index);
					if (toolIndex === undefined) {
						toolIndex = this._nextToolIndex++;
						this._toolIndexByBlock.set(index, toolIndex);
						this._blockTypes.set(index, "tool");
						events.push({
							type: "tool_call_start",
							index: toolIndex,
							id: generateId("toolu"),
							name: "",
						});
					}
					const partial = stringAt(delta, "partial_json");
					if (partial !== undefined && partial.length > 0) {
						events.push({ type: "tool_call_arguments", index: toolIndex, delta: partial });
					}
				}
				break;
			}
			case "content_block_stop": {
				const index = numberAt(payload, "index") ?? 0;
				const blockType = this._blockTypes.get(index);
				if (blockType === "tool") {
					const toolIndex = this._toolIndexByBlock.get(index);
					if (toolIndex !== undefined) {
						events.push({ type: "tool_call_stop", index: toolIndex });
					}
				}
				this._blockTypes.delete(index);
				break;
			}
			case "message_delta": {
				const usage = recordAt(payload, "usage");
				if (usage !== undefined) {
					this._usage = mergeUsage(this._usage, usageFromAnthropic(usage));
					events.push({ type: "usage", usage: this._usage });
				}
				const delta = recordAt(payload, "delta");
				const stopReason = stringAt(delta, "stop_reason");
				if (stopReason !== undefined && !this._finished) {
					this._finished = true;
					const mapped = finishFromAnthropic(stopReason);
					const reason: CanonicalFinishReason =
						this._sawToolCall && mapped !== "length" && mapped !== "content_filter"
							? "tool_calls"
							: mapped;
					events.push({
						type: "finish",
						reason: reason,
						...(stringAt(delta, "stop_sequence") === undefined
							? {}
							: { stopSequence: stringAt(delta, "stop_sequence") }),
					});
				}
				break;
			}
			case "message_stop": {
				if (!this._finished) {
					this._finished = true;
					events.push({ type: "finish", reason: "stop" });
				}
				break;
			}
			case "ping":
				events.push({ type: "ping" });
				break;
			case "error": {
				const error = recordAt(payload, "error");
				events.push({
					type: "error",
					errorType: stringAt(error, "type") ?? "api_error",
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

/**
 * Messages SSE 编码器。
 */
export class MessagesStreamEncoder implements CanonicalStreamEncoder {
	private readonly _options: CanonicalStreamOptions;
	private _id = "";
	private _model = "";
	private _started = false;
	private _finished = false;
	private _terminal = false;
	private _nextBlockIndex = 0;
	private _openBlock: { index: number; type: "text" | "thinking" } | undefined;
	private _toolBlockByIndex = new Map<number, number>();
	private _usage: CanonicalUsage | undefined;
	private _sawToolCall = false;
	private _stopSequence: string | undefined;
	private _finishReason: import("../ir").CanonicalFinishReason | undefined;

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
				this._id = event.id;
				this._model = this._options.model;
				if (event.usage !== undefined) {
					this._usage = mergeUsage(this._usage, event.usage);
				}
				return this._startFrames();
			}
			case "text_delta": {
				const frames = [...this._startFrames(), ...this._ensureBlock("text")];
				const block = this._openBlock;
				if (block !== undefined) {
					frames.push({
						event: "content_block_delta",
						data: {
							type: "content_block_delta",
							index: block.index,
							delta: { type: "text_delta", text: event.text },
						},
					});
				}
				return frames;
			}
			case "refusal_delta": {
				const frames = [...this._startFrames(), ...this._ensureBlock("text")];
				const block = this._openBlock;
				if (block !== undefined) {
					frames.push({
						event: "content_block_delta",
						data: {
							type: "content_block_delta",
							index: block.index,
							delta: { type: "text_delta", text: event.text },
						},
					});
				}
				return frames;
			}
			case "thinking_delta": {
				const frames = [...this._startFrames(), ...this._ensureBlock("thinking")];
				const block = this._openBlock;
				if (block !== undefined) {
					frames.push({
						event: "content_block_delta",
						data: {
							type: "content_block_delta",
							index: block.index,
							delta: { type: "thinking_delta", thinking: event.text },
						},
					});
				}
				return frames;
			}
			case "thinking_signature": {
				const frames = [...this._startFrames(), ...this._ensureBlock("thinking")];
				const block = this._openBlock;
				if (block !== undefined) {
					frames.push({
						event: "content_block_delta",
						data: {
							type: "content_block_delta",
							index: block.index,
							delta: { type: "signature_delta", signature: event.signature },
						},
					});
				}
				return frames;
			}
			case "tool_call_start": {
				this._sawToolCall = true;
				const frames = [...this._startFrames(), ...this._closeBlock()];
				const index = this._nextBlockIndex++;
				this._toolBlockByIndex.set(event.index, index);
				frames.push({
					event: "content_block_start",
					data: {
						type: "content_block_start",
						index: index,
						content_block: {
							type: "tool_use",
							id: event.id,
							name: event.name,
							input: {},
						},
					},
				});
				return frames;
			}
			case "tool_call_arguments": {
				const blockIndex = this._toolBlockByIndex.get(event.index);
				if (blockIndex === undefined) {
					return [];
				}
				return [
					{
						event: "content_block_delta",
						data: {
							type: "content_block_delta",
							index: blockIndex,
							delta: { type: "input_json_delta", partial_json: event.delta },
						},
					},
				];
			}
			case "tool_call_stop": {
				const blockIndex = this._toolBlockByIndex.get(event.index);
				if (blockIndex === undefined) {
					return [];
				}
				this._toolBlockByIndex.delete(event.index);
				return [
					{
						event: "content_block_stop",
						data: { type: "content_block_stop", index: blockIndex },
					},
				];
			}
			case "usage": {
				this._usage = mergeUsage(this._usage, event.usage);
				return [];
			}
			case "finish": {
				if (this._finished) {
					return [];
				}
				this._finished = true;
				this._stopSequence = event.stopSequence;
				this._finishReason = event.reason;
				// 终止帧延迟到 flush，等待可能紧随其后的 usage 分片。
				return [...this._startFrames(), ...this._closeBlock()];
			}
			case "error": {
				if (this._finished) {
					return [];
				}
				this._finished = true;
				this._terminal = true;
				return [
					...this._startFrames(),
					...this._closeBlock(),
					{
						event: "error",
						data: { type: "error", error: { type: event.errorType, message: event.message } },
					},
				];
			}
			case "ping":
				return [{ event: "ping", data: { type: "ping" } }];
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
		const frames = [...this._startFrames(), ...this._closeBlock()];
		const reason =
			this._finishReason ?? (this._sawToolCall ? "tool_calls" : "stop");
		frames.push(this._messageDelta(reason));
		frames.push({ event: "message_stop", data: { type: "message_stop" } });
		this._finished = true;
		this._terminal = true;
		return frames;
	}

	private _ensureIdentity(): void {
		if (this._id.length === 0) {
			this._id = generateId("msg");
		}
		if (this._model.length === 0) {
			this._model = this._options.model;
		}
	}

	private _startFrames(): ProtocolEvent[] {
		if (this._started) {
			return [];
		}
		this._started = true;
		this._ensureIdentity();
		const usage = this._usage;
		return [
			{
				event: "message_start",
				data: {
					type: "message_start",
					message: {
						id: this._id,
						type: "message",
						role: "assistant",
						model: this._model,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage:
							usage === undefined
								? { input_tokens: 0, output_tokens: 0 }
								: anthropicUsage(usage),
					},
				},
			},
		];
	}

	private _ensureBlock(type: "text" | "thinking"): ProtocolEvent[] {
		if (this._openBlock?.type === type) {
			return [];
		}
		const frames = this._closeBlock();
		const index = this._nextBlockIndex++;
		this._openBlock = { index: index, type: type };
		frames.push({
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: index,
				content_block:
					type === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" },
			},
		});
		return frames;
	}

	private _closeBlock(): ProtocolEvent[] {
		const block = this._openBlock;
		if (block === undefined) {
			return [];
		}
		this._openBlock = undefined;
		return [
			{
				event: "content_block_stop",
				data: { type: "content_block_stop", index: block.index },
			},
		];
	}

	private _messageDelta(reason: import("../ir").CanonicalFinishReason): ProtocolEvent {
		this._ensureIdentity();
		const usage = this._usage;
		return {
			event: "message_delta",
			data: {
				type: "message_delta",
				delta: {
					stop_reason: finishToAnthropic(reason, this._sawToolCall),
					stop_sequence: this._stopSequence ?? null,
				},
				usage:
					usage === undefined
						? { output_tokens: 0 }
						: anthropicUsage(usage),
			},
		};
	}
}

/**
 * 创建 Messages 流解码器。
 * @param options - 流式选项
 */
export function createMessagesStreamDecoder(options: CanonicalStreamOptions): CanonicalStreamDecoder {
	return new MessagesStreamDecoder(options);
}

/**
 * 创建 Messages 流编码器。
 * @param options - 流式选项
 */
export function createMessagesStreamEncoder(options: CanonicalStreamOptions): CanonicalStreamEncoder {
	return new MessagesStreamEncoder(options);
}
