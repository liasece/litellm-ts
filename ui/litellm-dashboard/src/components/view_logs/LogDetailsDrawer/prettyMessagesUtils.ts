/*
 * Provider-neutral parsing for the log detail Pretty view.
 */

import {
	MessagePart,
	ParsedMessage,
	ParsedMessages,
	RequestMeta,
	RequestTool,
	RoleStyle,
	ToolCall,
} from "./prettyMessagesTypes";
import { isMeaningful, PRETTY_FIELD_RULES, readFieldRule, type FieldRule } from "./prettyFieldRules";

export const ROLE_STYLES: Record<string, RoleStyle> = {
	system: { background: "transparent", borderColor: "#8c8c8c", label: "SYSTEM", labelColor: "#8c8c8c" },
	user: { background: "transparent", borderColor: "#1677ff", label: "USER", labelColor: "#1677ff" },
	assistant: { background: "transparent", borderColor: "#52c41a", label: "ASSISTANT", labelColor: "#52c41a" },
	tool: { background: "transparent", borderColor: "#fa8c16", label: "TOOL RESULT", labelColor: "#fa8c16" },
};

const safeJsonStringify = (value: any, pretty = false): string => {
	try {
		const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return "[Unserializable content]";
	}
};

const asRecord = (value: any): Record<string, any> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;

const parseToolArguments = (args: any): Record<string, any> => {
	if (typeof args === "string") {
		try {
			const parsed = JSON.parse(args);
			return asRecord(parsed) || { value: parsed };
		} catch {
			return { raw: args };
		}
	}
	return asRecord(args) || (args === null || args === undefined ? {} : { raw: args });
};

/**
 * 从内容块按规则表取字段；规则集中在 {@link PRETTY_FIELD_RULES}。
 * @param record - 内容块或消息对象
 * @param rule - 该语义的提取规则
 */
const pickField = (record: any, rule: FieldRule): any => readFieldRule(record, rule);

const valueToText = (value: any): string => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") return item;
				if (typeof item?.text === "string") return item.text;
				return safeJsonStringify(item, true);
			})
			.filter(Boolean)
			.join("\n");
	}
	if (typeof value?.text === "string") return value.text;
	return value === null || value === undefined ? "" : safeJsonStringify(value, true);
};

const toolCallPart = (
	block: Record<string, any>,
	label: string,
	name: any,
	args: any,
): { part: MessagePart; toolCall: ToolCall } => {
	const toolCall = {
		id: String(pickField(block, PRETTY_FIELD_RULES.toolCallId) || ""),
		name: typeof name === "string" && name ? name : "unknown",
		arguments: parseToolArguments(args),
	};
	return {
		part: {
			kind: "tool_call",
			label,
			sourceType: block.type,
			id: toolCall.id,
			name: toolCall.name,
			data: toolCall.arguments,
			status: typeof block.status === "string" ? block.status : undefined,
		},
		toolCall,
	};
};

const imageMimeType = (value: any): string => {
	if (typeof value !== "string") return "image/png";
	const normalized = value.trim().toLowerCase();
	if (normalized.startsWith("image/")) return normalized;
	if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
	if (normalized === "webp") return "image/webp";
	if (normalized === "gif") return "image/gif";
	return "image/png";
};

const imageSource = (value: any, mimeType: string, base64 = false): string | undefined => {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const source = value.trim();
	if (source.includes("litellm_truncated")) return undefined;
	if (/^(?:data:image\/|https?:\/\/)/i.test(source)) return source;
	return base64 ? `data:${mimeType};base64,${source}` : undefined;
};

const TRUNCATED_IMAGE_MESSAGE = "图片数据在日志入库时被截断，无法显示。";

const generatedImagePart = (value: any, outputFormat?: any, sourceType = "image_generation"): MessagePart | null => {
	const image = asRecord(value);
	if (!image) return null;
	const mimeType = imageMimeType(pickField(image, PRETTY_FIELD_RULES.imageMimeType) ?? outputFormat);
	const encodedImage = image.b64_json ?? image.result;
	const wasTruncated = typeof encodedImage === "string" && encodedImage.includes("litellm_truncated");
	const source =
		imageSource(image.b64_json, mimeType, true) ??
		imageSource(image.result, mimeType, true) ??
		imageSource(image.image_url?.url ?? image.image_url ?? image.url, mimeType);
	if (!source && !wasTruncated) return null;
	return {
		kind: "image",
		label: "Generated image",
		sourceType,
		id: typeof image.id === "string" ? image.id : undefined,
		status: typeof image.status === "string" ? image.status : undefined,
		text: wasTruncated
			? TRUNCATED_IMAGE_MESSAGE
			: typeof image.revised_prompt === "string"
				? image.revised_prompt
				: undefined,
		data: source ? { src: source, mimeType } : { truncated: true },
	};
};

const structuredToolResultParts = (value: any): MessagePart[] | undefined => {
	let structured = value;
	if (typeof value === "string" && (value.trimStart().startsWith("[") || value.trimStart().startsWith("{"))) {
		try {
			structured = JSON.parse(value);
		} catch {
			return undefined;
		}
	}

	const record = asRecord(structured);
	const blocks = Array.isArray(structured)
		? structured
		: Array.isArray(record?.content)
			? record.content
			: typeof record?.type === "string"
				? [record]
				: null;
	if (
		!blocks?.length ||
		!blocks.every(
			(block: any) =>
				typeof block === "string" ||
				Boolean(
					asRecord(block)?.type ||
						asRecord(block)?.functionCall ||
						asRecord(block)?.functionResponse ||
						asRecord(block)?.inlineData ||
						asRecord(block)?.inline_data ||
						asRecord(block)?.fileData ||
						asRecord(block)?.file_data,
				),
		)
	) {
		return undefined;
	}
	return blocks.map((block: any) => parseContentBlock(block).part);
};

const toolResultSummary = (parts: MessagePart[]): string =>
	parts
		.map((part) => {
			if (part.kind === "image") {
				const data = asRecord(part.data);
				return data?.truncated === true ? TRUNCATED_IMAGE_MESSAGE : "[Image]";
			}
			if (part.kind === "thinking") return `[Thinking]\n${part.text || ""}`.trim();
			if (part.kind === "redacted_thinking") return "[Redacted thinking]";
			return part.text || (part.data !== undefined ? safeJsonStringify(part.data, true) : "");
		})
		.filter(Boolean)
		.join("\n");

function parseContentBlock(rawBlock: any): { part: MessagePart; toolCall?: ToolCall } {
	if (typeof rawBlock === "string") {
		return { part: { kind: "text", label: "Text", text: rawBlock } };
	}
	const block = asRecord(rawBlock);
	if (!block) {
		return {
			part: {
				kind: "unknown",
				label: "Unsupported block",
				sourceType: "unknown",
				data: rawBlock,
			},
		};
	}

	if (asRecord(block.functionCall)) {
		const functionCall = block.functionCall;
		return toolCallPart(block, "Function call", functionCall.name, functionCall.args);
	}
	if (asRecord(block.functionResponse)) {
		const functionResponse = block.functionResponse;
		const result = functionResponse.response;
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: "Function result",
				sourceType: "functionResponse",
				name: functionResponse.name,
				text: parts ? toolResultSummary(parts) : valueToText(result),
				data: result,
				parts,
			},
		};
	}
	if (asRecord(block.executableCode)) {
		return {
			part: {
				kind: "code",
				label: `Executable code${block.executableCode.language ? ` · ${block.executableCode.language}` : ""}`,
				sourceType: "executableCode",
				text: valueToText(block.executableCode.code),
			},
		};
	}
	if (asRecord(block.codeExecutionResult)) {
		return {
			part: {
				kind: "code_result",
				label: "Code result",
				sourceType: "codeExecutionResult",
				status: block.codeExecutionResult.outcome,
				text: valueToText(block.codeExecutionResult.output),
				data: block.codeExecutionResult,
			},
		};
	}
	if (block.inlineData || block.inline_data || block.fileData || block.file_data) {
		const media = block.inlineData || block.inline_data || block.fileData || block.file_data;
		const mimeType = imageMimeType(media?.mimeType ?? media?.mime_type);
		const source = imageSource(media?.data, mimeType, true) ?? imageSource(media?.fileUri ?? media?.file_uri, mimeType);
		return {
			part: {
				kind: "image",
				label: "Media",
				sourceType: block.inlineData || block.inline_data ? "inlineData" : "fileData",
				text: media?.mimeType || media?.mime_type || media?.fileUri || media?.file_uri || "Attached media",
				data: source ? { src: source, mimeType } : undefined,
			},
		};
	}

	const type = typeof block.type === "string" ? block.type : "";
	if (["text", "input_text", "output_text"].includes(type) || (!type && typeof block.text === "string")) {
		if (block.thought === true) {
			return { part: { kind: "thinking", label: "Thinking", sourceType: type || "thought", text: block.text } };
		}
		return { part: { kind: "text", label: "Text", sourceType: type || "text", text: valueToText(block.text) } };
	}
	if (["thinking", "reasoning", "analysis"].includes(type)) {
		const text = valueToText(pickField(block, PRETTY_FIELD_RULES.reasoning));
		// Anthropic 的加密思考块带 signature 但 thinking 为空：内容不在客户端可见，不能当成
		// 普通思考区渲染，否则页面只会出现一个空的 Thinking 框。
		if (text.trim().length === 0 && typeof block.signature === "string" && block.signature.length > 0) {
			return {
				part: {
					kind: "redacted_thinking",
					label: "Redacted thinking",
					sourceType: type,
					text: "Content redacted by provider",
				},
			};
		}
		return {
			part: {
				kind: "thinking",
				label: type === "thinking" ? "Thinking" : "Reasoning",
				sourceType: type,
				text: text,
			},
		};
	}
	if (type === "redacted_thinking") {
		return {
			part: {
				kind: "redacted_thinking",
				label: "Redacted thinking",
				sourceType: type,
				text: "Content redacted by provider",
			},
		};
	}
	if (["tool_use", "server_tool_use", "function_call", "custom_tool_call", "mcp_call"].includes(type)) {
		const label =
			type === "server_tool_use"
				? "Server tool call"
				: type === "mcp_call"
					? "MCP call"
					: type === "custom_tool_call"
						? "Custom tool call"
						: "Function call";
		return toolCallPart(
			block,
			label,
			pickField(block, PRETTY_FIELD_RULES.toolName),
			pickField(block, PRETTY_FIELD_RULES.toolArguments),
		);
	}
	if (
		[
			"tool_result",
			"function_call_output",
			"custom_tool_call_output",
			"mcp_call_output",
			"computer_call_output",
		].includes(type)
	) {
		const result = pickField(block, PRETTY_FIELD_RULES.toolResult);
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: type === "tool_result" ? "Tool result" : "Function result",
				sourceType: type,
				id: String(pickField(block, PRETTY_FIELD_RULES.toolCallId) || ""),
				name: block.name,
				text: parts ? toolResultSummary(parts) : valueToText(result),
				data: typeof result === "object" ? result : undefined,
				status: typeof block.status === "string" ? block.status : undefined,
				isError: block.is_error === true || block.status === "failed" || block.status === "error",
				parts,
			},
		};
	}
	if (["web_search_call", "web_search_tool_result", "web_search_result"].includes(type)) {
		return {
			part: {
				kind: "web_search",
				label: type === "web_search_call" ? "Web search" : "Web search result",
				sourceType: type,
				id: String(block.id || block.call_id || ""),
				status: block.status,
				text: valueToText(pickField(block, PRETTY_FIELD_RULES.webSearchText)),
				data: block.action ?? block.results,
			},
		};
	}
	if (type === "file_search_call") {
		return {
			part: {
				kind: "file_search",
				label: "File search",
				sourceType: type,
				id: String(block.id || block.call_id || ""),
				status: block.status,
				text: valueToText(block.queries),
				data: block.results,
			},
		};
	}
	if (type === "computer_call") {
		return {
			part: {
				kind: "computer",
				label: "Computer action",
				sourceType: type,
				id: String(block.id || block.call_id || ""),
				status: block.status,
				text: valueToText(block.action),
				data: block.action,
			},
		};
	}
	if (["code_interpreter_call", "executable_code"].includes(type)) {
		return {
			part: {
				kind: "code",
				label: type === "code_interpreter_call" ? "Code interpreter" : "Executable code",
				sourceType: type,
				id: String(block.id || block.call_id || ""),
				status: block.status,
				text: valueToText(pickField(block, PRETTY_FIELD_RULES.code)),
				data: block.outputs,
			},
		};
	}
	if (["code_execution_result", "code_interpreter_result"].includes(type)) {
		return {
			part: {
				kind: "code_result",
				label: "Code result",
				sourceType: type,
				status: block.status ?? block.outcome,
				text: valueToText(pickField(block, PRETTY_FIELD_RULES.codeResult)),
			},
		};
	}
	if (type === "image_generation_call") {
		const generated = generatedImagePart(block, block.output_format, type);
		if (generated) return { part: generated };
	}
	if (["image", "image_url", "input_image", "output_image"].includes(type)) {
		const imageData = asRecord(block.source);
		const mimeType = imageMimeType(pickField(block, PRETTY_FIELD_RULES.imageMimeType));
		const rawSource = pickField(block, PRETTY_FIELD_RULES.imageSource);
		const wasTruncated = typeof rawSource === "string" && rawSource.includes("litellm_truncated");
		const source = imageSource(
			rawSource,
			mimeType,
			imageData?.type === "base64" || (typeof block.data === "string" && rawSource === block.data),
		);
		return {
			part: {
				kind: "image",
				label: "Image",
				sourceType: type,
				text: wasTruncated
					? TRUNCATED_IMAGE_MESSAGE
					: valueToText(source ?? rawSource ?? block.file_id ?? "Attached image"),
				data: source ? { src: source, mimeType } : wasTruncated ? { truncated: true } : undefined,
			},
		};
	}
	if (["document", "input_file", "file"].includes(type)) {
		return {
			part: {
				kind: "document",
				label: "Document",
				sourceType: type,
				text: valueToText(pickField(block, PRETTY_FIELD_RULES.documentLabel)),
			},
		};
	}
	if (["audio", "input_audio", "output_audio"].includes(type)) {
		return { part: { kind: "audio", label: "Audio", sourceType: type, text: "Audio content" } };
	}
	if (type === "refusal") {
		return {
			part: { kind: "refusal", label: "Refusal", sourceType: type, text: valueToText(pickField(block, PRETTY_FIELD_RULES.refusal)) },
		};
	}

	return {
		part: {
			kind: "unknown",
			label: `Unsupported block${type ? ` · ${type}` : ""}`,
			sourceType: type || "unknown",
			data: block,
		},
	};
}

/**
 * 丢弃没有任何可见内容的思考分区。
 *
 * 上游有时只产出空白（实测 reasoning 文本是一个空格、reasoning_tokens 为 1）。这样的块
 * 如果照常渲染，页面会出现一个空白的「Reasoning」框，看起来像内容丢失。既然用户看不到
 * 任何东西，就不该为它生成分区。
 * @param parts - 解析后的内容分区
 */
const withoutEmptyThinking = (parts: MessagePart[]): MessagePart[] =>
	parts.filter((part) => part.kind !== "thinking" || (part.text ?? "").trim().length > 0);

const contentFromParts = (parts: MessagePart[]): string =>
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

const parseContent = (content: any): { content: string; parts?: MessagePart[]; toolCalls?: ToolCall[] } => {
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

const parseToolCalls = (toolCalls: any[]): ToolCall[] | undefined => {
	if (!Array.isArray(toolCalls)) return undefined;
	return toolCalls.map((toolCall) => ({
		id: toolCall.id || toolCall.call_id || "",
		name: toolCall.function?.name || toolCall.name || "unknown",
		arguments: parseToolArguments(toolCall.function?.arguments ?? toolCall.arguments ?? toolCall.input),
	}));
};

const toolCallsToParts = (toolCalls: ToolCall[] | undefined, label = "Function call"): MessagePart[] =>
	(toolCalls || []).map((toolCall) => ({
		kind: "tool_call",
		label,
		id: toolCall.id,
		name: toolCall.name,
		data: toolCall.arguments,
	}));

const normalizeRole = (role: any): ParsedMessage["role"] => {
	if (role === "model") return "assistant";
	return role === "system" || role === "assistant" || role === "tool" ? role : "user";
};

const parseRequestMessage = (message: any): ParsedMessage => {
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
				id: message?.tool_call_id,
				name: message?.name,
				text: parsed.content,
				parts: parsed.parts,
			},
		];
	}

	return {
		role,
		content: parsed.content,
		toolCalls: toolCalls.length ? toolCalls : undefined,
		toolCallId: message?.tool_call_id,
		parts: parts.length ? parts : undefined,
	};
};

const requestMessagesFrom = (request: any): ParsedMessage[] => {
	if (typeof request === "string") {
		return request.trim() ? [parseRequestMessage({ role: "user", content: request })] : [];
	}
	const body = asRecord(request?.body) || asRecord(request) || {};
	const messages = Array.isArray(body.messages)
		? body.messages
		: Array.isArray(request?.messages)
			? request.messages
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
			body.input.forEach((item: any) => {
				if (item?.type === "message" || item?.role) {
					result.push(parseRequestMessage({ role: item.role || "user", content: item.content ?? item }));
				} else {
					result.push(parseRequestMessage({ role: "user", content: [item] }));
				}
			});
		}
	}
	if (!messages && Array.isArray(body.contents)) {
		body.contents.forEach((item: any) => result.push(parseRequestMessage({ role: item.role, parts: item.parts })));
	}
	if (result.length === 0 && typeof body.prompt === "string") {
		result.push(parseRequestMessage({ role: "user", content: body.prompt }));
	}
	return result;
};

const responseFromParts = (parts: MessagePart[], role: any = "assistant"): ParsedMessage => {
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

/** tools[] 条目里已经由 {@link RequestTool} 承载的键；其余键放进 extra，避免展开后丢信息。 */
const REQUEST_TOOL_KEYS = new Set(["name", "type", "description", "function", "parameters", "input_schema"]);
/** function 子对象里已经由 {@link RequestTool} 承载的键。 */
const FUNCTION_TOOL_KEYS = new Set(["name", "description", "parameters"]);

const toolText = (value: unknown): string => (typeof value === "string" && value.trim() ? value : "");

/** 按候选顺序取第一个有内容的参数 schema：OpenAI function.parameters、Responses parameters、Anthropic input_schema。 */
const toolParameters = (...candidates: unknown[]): unknown => candidates.find(isMeaningful);

/**
 * 把一条 tools[] 定义归一成可展示的字段。
 *
 * 兼容 OpenAI chat（function.name/description/parameters）、OpenAI Responses（扁平
 * name/description/parameters）与 Anthropic（name/description/input_schema）。没有名字的
 * 供应商内置工具（如 Responses 的 web_search）用声明的 type 作名字；名字和 type 都取不到的
 * 条目无法展示，直接跳过。
 */
const requestToolFromDefinition = (tool: any): RequestTool | null => {
	const record = asRecord(tool);
	if (!record) return null;
	const fn = asRecord(record.function);
	const declaredType = toolText(record.type);
	const name = toolText(fn?.name) || toolText(record.name) || (declaredType !== "function" ? declaredType : "");
	if (!name) return null;

	const extra: Record<string, any> = {};
	for (const [key, value] of Object.entries(record)) {
		if (!REQUEST_TOOL_KEYS.has(key)) extra[key] = value;
	}
	for (const [key, value] of Object.entries(fn ?? {})) {
		if (!FUNCTION_TOOL_KEYS.has(key)) extra[`function.${key}`] = value;
	}

	const description = toolText(fn?.description) || toolText(record.description);
	const parameters = toolParameters(fn?.parameters, record.parameters, record.input_schema);

	return {
		name,
		type: declaredType || "function",
		...(description ? { description } : {}),
		...(parameters !== undefined ? { parameters } : {}),
		...(Object.keys(extra).length > 0 ? { extra } : {}),
	};
};

/**
 * 从请求中提取用于 pretty 视图顶部 tag 行的元信息。
 * 兼容 request 为 { body: {...} } 或直接为请求体对象两种形态。
 */
export const parseRequestMeta = (request: any): RequestMeta => {
	const body = asRecord(request?.body) || asRecord(request) || {};

	let reasoningEffort: string | undefined;
	if (typeof body.reasoning_effort === "string") {
		reasoningEffort = body.reasoning_effort;
	} else {
		const reasoning = asRecord(body.reasoning);
		if (reasoning && typeof reasoning.effort === "string") {
			reasoningEffort = reasoning.effort;
		} else {
			// Anthropic 原生 /v1/messages 用 output_config.effort 表达思考强度
			const outputConfig = asRecord(body.output_config);
			if (outputConfig && typeof outputConfig.effort === "string") {
				reasoningEffort = outputConfig.effort;
			}
		}
	}

	const thinking = asRecord(body.thinking);
	const thinkingBudget = thinking && typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : undefined;

	const tools = Array.isArray(body.tools)
		? body.tools
				.map(requestToolFromDefinition)
				.filter((tool: RequestTool | null): tool is RequestTool => tool !== null)
		: [];

	let maxTokens: number | undefined;
	if (typeof body.max_tokens === "number") {
		maxTokens = body.max_tokens;
	} else if (typeof body.max_completion_tokens === "number") {
		maxTokens = body.max_completion_tokens;
	}

	return {
		model: typeof body.model === "string" ? body.model : undefined,
		reasoningEffort,
		thinkingBudget,
		tools,
		temperature: typeof body.temperature === "number" ? body.temperature : undefined,
		topP: typeof body.top_p === "number" ? body.top_p : undefined,
		maxTokens,
		stream: typeof body.stream === "boolean" ? body.stream : undefined,
	};
};

/**
 * 判断请求对象是否带有可用于提取元信息的请求体。
 * 上游日志未开启或请求体未记录时返回 false，调用方应回退到下游请求。
 */
export function hasRequestMetaBody(request: any): boolean {
	const body = asRecord(request?.body) || asRecord(request);
	return Boolean(body && Object.keys(body).length > 0);
}

/**
 * 内置能力（web search / fetch 等）的响应不走 OpenAI choices，而是
 * { brief, results, executor } 这样的私有结构。Pretty 视图原先只认
 * choices / output / candidates，导致 Logs 详情里这类记录显示为空。
 * 这里把它们转成可读的 parts，使搜索结果与来源真正可见。
 * @param response - 已落库的 response 字段
 * @returns 解析后的 message；无法识别时返回 null
 */
const parseBuiltinCapabilityResponse = (response: any): ParsedMessage | null => {
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
		const snippet =
			typeof entry.snippet === "string" ? entry.snippet : typeof entry.summary === "string" ? entry.summary : "";
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
export const parseRequestMessages = (request: any): ParsedMessage[] => requestMessagesFrom(request);

/**
 * 只解析响应侧消息。
 * @param response - 已落库的 response 字段
 * @returns 解析后的响应消息；无法识别时返回 null
 */
export const parseResponseMessage = (response: any): ParsedMessage | null => {
	let responseMessage: ParsedMessage | null = null;
	const generatedImageParts = Array.isArray(response?.data)
		? response.data
				.map((item: any) => generatedImagePart(item, response.output_format))
				.filter((part: MessagePart | null): part is MessagePart => part !== null)
		: [];
	const builtinCapabilityMessage = parseBuiltinCapabilityResponse(response);
	const responseMsg = response?.choices?.[0]?.message;

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
			response.output.flatMap((item: any) => {
				if (item?.type === "message") return parseContent(item.content || []).parts || [];
				return [parseContentBlock(item).part];
			}),
		);
		responseMessage = responseFromParts(parts);
	} else if (generatedImageParts.length) {
		responseMessage = responseFromParts(generatedImageParts);
	} else if (Array.isArray(response?.candidates) && response.candidates[0]?.content) {
		const candidate = response.candidates[0].content;
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

export const parseMessages = (request: any, response: any): ParsedMessages => ({
	requestMessages: parseRequestMessages(request),
	responseMessage: parseResponseMessage(response),
});
