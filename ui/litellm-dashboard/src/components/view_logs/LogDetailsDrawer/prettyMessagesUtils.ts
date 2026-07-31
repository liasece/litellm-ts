/*
 * Provider-neutral parsing for the log detail Pretty view.
 */

import { MessagePart, ParsedMessage, ParsedMessages, RoleStyle, ToolCall } from "./prettyMessagesTypes";

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
		id: String(block.id || block.call_id || block.tool_use_id || ""),
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

const generatedImagePart = (value: any, outputFormat?: any, sourceType = "image_generation"): MessagePart | null => {
	const image = asRecord(value);
	if (!image) return null;
	const mimeType = imageMimeType(image.mime_type ?? image.mimeType ?? outputFormat);
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
			? "图片数据在日志入库时被截断，无法显示。"
			: typeof image.revised_prompt === "string"
				? image.revised_prompt
				: undefined,
		data: source ? { src: source, mimeType } : { truncated: true },
	};
};

const parseContentBlock = (rawBlock: any): { part: MessagePart; toolCall?: ToolCall } => {
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
		return {
			part: {
				kind: "tool_result",
				label: "Function result",
				sourceType: "functionResponse",
				name: functionResponse.name,
				text: valueToText(functionResponse.response),
				data: functionResponse.response,
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
		return {
			part: {
				kind: "thinking",
				label: type === "thinking" ? "Thinking" : "Reasoning",
				sourceType: type,
				text: valueToText(block.thinking ?? block.summary ?? block.text ?? block.content),
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
			block.name ?? block.function?.name,
			block.input ?? block.arguments ?? block.function?.arguments,
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
		const result = block.content ?? block.output ?? block.result ?? block.response;
		return {
			part: {
				kind: "tool_result",
				label: type === "tool_result" ? "Tool result" : "Function result",
				sourceType: type,
				id: String(block.tool_use_id || block.call_id || block.id || ""),
				name: block.name,
				text: valueToText(result),
				data: typeof result === "object" ? result : undefined,
				status: typeof block.status === "string" ? block.status : undefined,
				isError: block.is_error === true || block.status === "failed" || block.status === "error",
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
				text: valueToText(block.query ?? block.content ?? block.result),
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
				text: valueToText(block.code ?? block.input),
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
				text: valueToText(block.output ?? block.result),
			},
		};
	}
	if (type === "image_generation_call") {
		const generated = generatedImagePart(block, block.output_format, type);
		if (generated) return { part: generated };
	}
	if (["image", "image_url", "input_image", "output_image"].includes(type)) {
		const mimeType = imageMimeType(block.mime_type ?? block.mimeType);
		const source = imageSource(block.image_url?.url ?? block.image_url ?? block.url, mimeType);
		return {
			part: {
				kind: "image",
				label: "Image",
				sourceType: type,
				text: valueToText(block.image_url?.url ?? block.image_url ?? block.file_id ?? block.url ?? "Attached image"),
				data: source ? { src: source, mimeType } : undefined,
			},
		};
	}
	if (["document", "input_file", "file"].includes(type)) {
		return {
			part: {
				kind: "document",
				label: "Document",
				sourceType: type,
				text: valueToText(block.filename ?? block.file_id ?? block.url ?? block.source ?? "Attached document"),
			},
		};
	}
	if (["audio", "input_audio", "output_audio"].includes(type)) {
		return { part: { kind: "audio", label: "Audio", sourceType: type, text: "Audio content" } };
	}
	if (type === "refusal") {
		return {
			part: { kind: "refusal", label: "Refusal", sourceType: type, text: valueToText(block.refusal ?? block.text) },
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
};

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
		return {
			content: contentFromParts([parsed.part]),
			parts: [parsed.part],
			toolCalls: parsed.toolCall ? [parsed.toolCall] : undefined,
		};
	}

	const parsed = content.map(parseContentBlock);
	const parts = parsed.map((item) => item.part);
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
	const parsed = parseContent(message?.content ?? message?.parts ?? "");
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

export const parseMessages = (request: any, response: any): ParsedMessages => {
	const requestMessages = requestMessagesFrom(request);
	let responseMessage: ParsedMessage | null = null;
	const generatedImageParts = Array.isArray(response?.data)
		? response.data
				.map((item: any) => generatedImagePart(item, response.output_format))
				.filter((part: MessagePart | null): part is MessagePart => part !== null)
		: [];
	const responseMsg = response?.choices?.[0]?.message;

	if (responseMsg) {
		const parsed = parseContent(responseMsg.content ?? "");
		const reasoning = responseMsg.reasoning_content ?? responseMsg.reasoning ?? responseMsg.analysis;
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
		const parts = response.output.flatMap((item: any) => {
			if (item?.type === "message") return parseContent(item.content || []).parts || [];
			return [parseContentBlock(item).part];
		});
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

	return { requestMessages, responseMessage };
};
