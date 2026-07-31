export type SessionTimelineRole = "system" | "user" | "assistant" | "tool" | "request" | "error";

export type SessionTimelinePartKind =
	| "text"
	| "thinking"
	| "redacted_thinking"
	| "tool_call"
	| "tool_result"
	| "web_search"
	| "file_search"
	| "computer"
	| "code"
	| "code_result"
	| "image"
	| "document"
	| "audio"
	| "refusal"
	| "unknown";

export interface SessionTimelinePart {
	readonly kind: SessionTimelinePartKind;
	readonly label: string;
	readonly sourceType?: string;
	readonly id?: string;
	readonly name?: string;
	readonly text?: string;
	readonly data?: unknown;
	readonly status?: string;
	readonly isError?: boolean;
}

interface ParsedMessage {
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly content: string;
	readonly toolCalls?: ToolCall[];
	readonly toolCallId?: string;
	readonly parts?: SessionTimelinePart[];
}

interface ToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
}

export interface SessionTimelineSourceRow {
	readonly request_id: string;
	readonly call_type: string;
	readonly api_key?: string | null;
	readonly key_alias?: string | null;
	readonly spend: number;
	readonly total_tokens: number;
	readonly startTime: Date | string;
	readonly endTime: Date | string;
	readonly model: string;
	readonly status: string | null;
	readonly metadata_status: string | null;
	readonly error_information: unknown;
	readonly request_payload: unknown;
	readonly response_payload: unknown;
	readonly request_client?: string | null;
	readonly request_system_count?: number | null;
	readonly request_message_count?: number | null;
	readonly request_tool_count?: number | null;
	readonly request_first_tool_name?: string | null;
	readonly request_first_system_prompt?: string | null;
	readonly request_second_system_prompt?: string | null;
}

export interface SessionTimelineItem {
	readonly id: string;
	readonly request_id: string;
	readonly role: SessionTimelineRole;
	readonly label: string;
	readonly timestamp: string;
	readonly model: string;
	readonly content: string;
	parts?: SessionTimelinePart[];
	readonly status?: string;
}

export interface SessionTimelineResponse {
	readonly data: SessionTimelineItem[];
	readonly summary: {
		readonly keys: ReadonlyArray<{
			readonly alias: string | null;
			readonly hash: string;
		}>;
		readonly request_count: number;
		readonly event_count: number;
		readonly total_spend: number;
		readonly total_tokens: number;
		readonly duration_seconds: number;
		readonly start_time: string | null;
		readonly end_time: string | null;
		readonly filtered_request_count: number;
	};
}

export interface SessionTimelineBuilderOptions {
	/**
	 * Debug/audit escape hatch. The default timeline removes only high-confidence
	 * Claude Code service calls; callers can explicitly request the raw sequence.
	 */
	readonly includeAuxiliary?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeJsonStringify(value: unknown, pretty = false): string {
	try {
		const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return "[Unserializable content]";
	}
}

function parseToolArguments(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			return asRecord(parsed) ?? { value: parsed };
		} catch {
			return { raw: value };
		}
	}
	return asRecord(value) ?? (value === null || value === undefined ? {} : { raw: value });
}

function valueToText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") return item;
				const itemRecord = asRecord(item);
				if (typeof itemRecord?.text === "string") return itemRecord.text;
				return safeJsonStringify(item, true);
			})
			.filter(Boolean)
			.join("\n");
	}
	const record = asRecord(value);
	if (typeof record?.text === "string") return record.text;
	return value === null || value === undefined ? "" : safeJsonStringify(value, true);
}

function toolCallPart(
	block: Record<string, unknown>,
	label: string,
	name: unknown,
	args: unknown,
): { part: SessionTimelinePart; toolCall: ToolCall } {
	const toolCall = {
		id: String(block.id ?? block.call_id ?? block.tool_use_id ?? ""),
		name: typeof name === "string" && name ? name : "unknown",
		arguments: parseToolArguments(args),
	};
	return {
		part: {
			kind: "tool_call",
			label: label,
			sourceType: typeof block.type === "string" ? block.type : undefined,
			id: toolCall.id,
			name: toolCall.name,
			data: toolCall.arguments,
			status: typeof block.status === "string" ? block.status : undefined,
		},
		toolCall: toolCall,
	};
}

function reasoningText(block: Record<string, unknown>): string {
	const directText = block.thinking ?? block.text ?? block.content;
	if (directText !== undefined) return valueToText(directText);
	if (!Array.isArray(block.summary)) return valueToText(block.summary);
	return block.summary
		.map((item) => {
			const summaryItem = asRecord(item);
			return valueToText(summaryItem?.text ?? summaryItem?.summary ?? item);
		})
		.filter(Boolean)
		.join("\n");
}

function imageMimeType(value: unknown): string {
	if (typeof value !== "string") return "image/png";
	const normalized = value.trim().toLowerCase();
	if (normalized.startsWith("image/")) return normalized;
	if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
	if (normalized === "webp") return "image/webp";
	if (normalized === "gif") return "image/gif";
	return "image/png";
}

function imageSource(value: unknown, mimeType: string, base64 = false): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const source = value.trim();
	if (source.includes("litellm_truncated")) return undefined;
	if (/^(?:data:image\/|https?:\/\/)/i.test(source)) return source;
	return base64 ? `data:${mimeType};base64,${source}` : undefined;
}

function generatedImagePart(value: unknown, outputFormat?: unknown, sourceType = "image_generation"): SessionTimelinePart | null {
	const image = asRecord(value);
	if (!image) return null;
	const mimeType = imageMimeType(image.mime_type ?? image.mimeType ?? outputFormat);
	const imageUrl = asRecord(image.image_url);
	const encodedImage = image.b64_json ?? image.result;
	const wasTruncated = typeof encodedImage === "string" && encodedImage.includes("litellm_truncated");
	const source =
		imageSource(image.b64_json, mimeType, true) ??
		imageSource(image.result, mimeType, true) ??
		imageSource(imageUrl?.url ?? image.image_url ?? image.url, mimeType);
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
}

function parseContentBlock(rawBlock: unknown): { part: SessionTimelinePart; toolCall?: ToolCall } {
	if (typeof rawBlock === "string") {
		return { part: { kind: "text", label: "Text", text: rawBlock } };
	}
	const block = asRecord(rawBlock);
	if (!block) {
		return { part: { kind: "unknown", label: "Unsupported block", sourceType: "unknown", data: rawBlock } };
	}

	const functionCall = asRecord(block.functionCall);
	if (functionCall) {
		return toolCallPart(block, "Function call", functionCall.name, functionCall.args);
	}
	const functionResponse = asRecord(block.functionResponse);
	if (functionResponse) {
		return {
			part: {
				kind: "tool_result",
				label: "Function result",
				sourceType: "functionResponse",
				name: typeof functionResponse.name === "string" ? functionResponse.name : undefined,
				text: valueToText(functionResponse.response),
				data: functionResponse.response,
			},
		};
	}
	const executableCode = asRecord(block.executableCode);
	if (executableCode) {
		return {
			part: {
				kind: "code",
				label: `Executable code${executableCode.language ? ` · ${String(executableCode.language)}` : ""}`,
				sourceType: "executableCode",
				text: valueToText(executableCode.code),
			},
		};
	}
	const codeExecutionResult = asRecord(block.codeExecutionResult);
	if (codeExecutionResult) {
		return {
			part: {
				kind: "code_result",
				label: "Code result",
				sourceType: "codeExecutionResult",
				status: typeof codeExecutionResult.outcome === "string" ? codeExecutionResult.outcome : undefined,
				text: valueToText(codeExecutionResult.output),
				data: codeExecutionResult,
			},
		};
	}

	const media = asRecord(block.inlineData ?? block.inline_data ?? block.fileData ?? block.file_data);
	if (media) {
		const mimeType = imageMimeType(media.mimeType ?? media.mime_type);
		const source = imageSource(media.data, mimeType, true) ?? imageSource(media.fileUri ?? media.file_uri, mimeType);
		return {
			part: {
				kind: "image",
				label: "Media",
				sourceType: block.inlineData ?? block.inline_data ? "inlineData" : "fileData",
				text: String(media.mimeType ?? media.mime_type ?? media.fileUri ?? media.file_uri ?? "Attached media"),
				data: source ? { src: source, mimeType } : undefined,
			},
		};
	}

	const type = typeof block.type === "string" ? block.type : "";
	if (["text", "input_text", "output_text"].includes(type) || (!type && typeof block.text === "string")) {
		return block.thought === true
			? { part: { kind: "thinking", label: "Thinking", sourceType: type || "thought", text: valueToText(block.text) } }
			: { part: { kind: "text", label: "Text", sourceType: type || "text", text: valueToText(block.text) } };
	}
	if (["thinking", "reasoning", "analysis"].includes(type)) {
		return {
			part: {
				kind: "thinking",
				label: type === "thinking" ? "Thinking" : "Reasoning",
				sourceType: type,
				text: reasoningText(block),
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
		const functionRecord = asRecord(block.function);
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
			block.name ?? functionRecord?.name,
			block.input ?? block.arguments ?? functionRecord?.arguments,
		);
	}
	if (
		["tool_result", "function_call_output", "custom_tool_call_output", "mcp_call_output", "computer_call_output"].includes(
			type,
		)
	) {
		const result = block.content ?? block.output ?? block.result ?? block.response;
		return {
			part: {
				kind: "tool_result",
				label: type === "tool_result" ? "Tool result" : "Function result",
				sourceType: type,
				id: String(block.tool_use_id ?? block.call_id ?? block.id ?? ""),
				name: typeof block.name === "string" ? block.name : undefined,
				text: valueToText(result),
				data: result !== null && typeof result === "object" ? result : undefined,
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
				id: String(block.id ?? block.call_id ?? ""),
				status: typeof block.status === "string" ? block.status : undefined,
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
				id: String(block.id ?? block.call_id ?? ""),
				status: typeof block.status === "string" ? block.status : undefined,
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
				id: String(block.id ?? block.call_id ?? ""),
				status: typeof block.status === "string" ? block.status : undefined,
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
				id: String(block.id ?? block.call_id ?? ""),
				status: typeof block.status === "string" ? block.status : undefined,
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
				status: typeof (block.status ?? block.outcome) === "string" ? String(block.status ?? block.outcome) : undefined,
				text: valueToText(block.output ?? block.result),
			},
		};
	}
	if (type === "image_generation_call") {
		const generated = generatedImagePart(block, block.output_format, type);
		if (generated) return { part: generated };
	}
	if (["image", "image_url", "input_image", "output_image"].includes(type)) {
		const imageUrl = asRecord(block.image_url);
		const mimeType = imageMimeType(block.mime_type ?? block.mimeType);
		const source = imageSource(imageUrl?.url ?? block.image_url ?? block.url, mimeType);
		return {
			part: {
				kind: "image",
				label: "Image",
				sourceType: type,
				text: valueToText(imageUrl?.url ?? block.image_url ?? block.file_id ?? block.url ?? "Attached image"),
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
}

function contentFromParts(parts: SessionTimelinePart[]): string {
	return parts
		.map((part) => {
			if (part.kind === "text" || part.kind === "tool_result" || part.kind === "image" || part.kind === "refusal") {
				return part.text ?? "";
			}
			if (part.kind === "thinking") return `[Thinking]\n${part.text ?? ""}`.trim();
			if (part.kind === "redacted_thinking") return "[Redacted thinking]";
			if (part.kind === "unknown") {
				return `[Unknown block: ${part.sourceType ?? "unknown"}]\n${safeJsonStringify(part.data)}`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function parseContent(content: unknown): { content: string; parts?: SessionTimelinePart[]; toolCalls?: ToolCall[] } {
	if (typeof content === "string") {
		return { content: content, parts: [{ kind: "text", label: "Text", text: content }] };
	}
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
		parts: parts,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
}

function parseToolCalls(value: unknown): ToolCall[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.map((rawToolCall) => {
		const toolCall = asRecord(rawToolCall) ?? {};
		const fn = asRecord(toolCall.function);
		return {
			id: String(toolCall.id ?? toolCall.call_id ?? ""),
			name: String(fn?.name ?? toolCall.name ?? "unknown"),
			arguments: parseToolArguments(fn?.arguments ?? toolCall.arguments ?? toolCall.input),
		};
	});
}

function toolCallsToParts(toolCalls: ToolCall[] | undefined, label = "Function call"): SessionTimelinePart[] {
	return (toolCalls ?? []).map((toolCall) => ({
		kind: "tool_call",
		label: label,
		id: toolCall.id,
		name: toolCall.name,
		data: toolCall.arguments,
	}));
}

function normalizeRole(role: unknown): ParsedMessage["role"] {
	if (role === "model") return "assistant";
	if (role === "developer") return "system";
	return role === "system" || role === "assistant" || role === "tool" ? role : "user";
}

function parseRequestMessage(value: unknown): ParsedMessage {
	const message = asRecord(value) ?? {};
	const parsed = parseContent(message.content ?? message.parts ?? "");
	const explicitToolCalls = parseToolCalls(message.tool_calls);
	const toolCalls = [...(parsed.toolCalls ?? []), ...(explicitToolCalls ?? [])];
	let parts = [...(parsed.parts ?? []), ...toolCallsToParts(explicitToolCalls)];
	const role = normalizeRole(message.role);
	if (role === "tool" && !parts.some((part) => part.kind === "tool_result")) {
		parts = [
			{
				kind: "tool_result",
				label: "Tool result",
				id: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
				name: typeof message.name === "string" ? message.name : undefined,
				text: parsed.content,
			},
		];
	}
	return {
		role: role,
		content: parsed.content,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
		parts: parts.length > 0 ? parts : undefined,
	};
}

const RESPONSES_INPUT_ITEM_TYPES = new Set([
	"additional_tools",
	"message",
	"reasoning",
	"custom_tool_call",
	"custom_tool_call_output",
	"function_call",
	"function_call_output",
	"mcp_call",
	"mcp_call_output",
	"computer_call",
	"computer_call_output",
	"web_search_call",
	"web_search_tool_result",
	"web_search_result",
	"file_search_call",
	"code_interpreter_call",
	"code_interpreter_result",
	"code_execution_result",
	"image_generation_call",
]);

const RESPONSES_TOOL_RESULT_TYPES = new Set([
	"custom_tool_call_output",
	"function_call_output",
	"mcp_call_output",
	"computer_call_output",
	"web_search_tool_result",
	"web_search_result",
	"code_interpreter_result",
	"code_execution_result",
]);

function looksLikeResponsesInputItems(items: unknown[]): boolean {
	return items.some((item) => {
		const type = asRecord(item)?.type;
		return typeof type === "string" && RESPONSES_INPUT_ITEM_TYPES.has(type);
	});
}

function hasRenderableMessageContent(message: ParsedMessage): boolean {
	const parts = message.parts ?? [];
	if (parts.length === 0) return Boolean(message.content.trim());
	return parts.some((part) => {
		if (["text", "thinking", "tool_result", "refusal"].includes(part.kind)) return Boolean(part.text?.trim());
		if (part.kind === "unknown") return part.data !== undefined && part.data !== null;
		return true;
	});
}

/**
 * OpenAI Responses stores cumulative history as a heterogeneous input-item
 * stream, not as Chat Completions messages. Tool calls, tool outputs and
 * reasoning therefore need roles inferred from their item type. The
 * additional_tools item is only a client tool registry and is not a turn.
 */
function parseResponsesInputItems(items: unknown[]): ParsedMessage[] {
	const result: ParsedMessage[] = [];
	for (const item of items) {
		if (typeof item === "string") {
			const message = parseRequestMessage({ role: "user", content: item });
			if (hasRenderableMessageContent(message)) result.push(message);
			continue;
		}

		const itemRecord = asRecord(item);
		if (!itemRecord) continue;
		const type = typeof itemRecord.type === "string" ? itemRecord.type : "";
		if (type === "additional_tools") continue;

		let message: ParsedMessage;
		if (type === "message" || itemRecord.role !== undefined) {
			message = parseRequestMessage({
				role: itemRecord.role ?? "user",
				content: itemRecord.content ?? item,
			});
		} else if (RESPONSES_TOOL_RESULT_TYPES.has(type)) {
			message = parseRequestMessage({ role: "tool", content: [item] });
		} else {
			message = parseRequestMessage({ role: "assistant", content: [item] });
		}
		if (hasRenderableMessageContent(message)) result.push(message);
	}
	return result;
}

function requestMessagesFrom(value: unknown): ParsedMessage[] {
	if (typeof value === "string") {
		return value.trim() ? [parseRequestMessage({ role: "user", content: value })] : [];
	}
	const request = Array.isArray(value) ? { messages: value } : (asRecord(value) ?? {});
	const body = asRecord(request.body) ?? request;
	const rawMessages = Array.isArray(body.messages)
		? body.messages
		: Array.isArray(request.messages)
			? request.messages
			: null;
	const result = rawMessages
		? looksLikeResponsesInputItems(rawMessages)
			? parseResponsesInputItems(rawMessages)
			: rawMessages.map(parseRequestMessage)
		: [];
	const systemContent = body.system ?? body.instructions;
	if (systemContent !== undefined && !result.some((message) => message.role === "system")) {
		result.unshift(parseRequestMessage({ role: "system", content: systemContent }));
	}
	if (!rawMessages && body.input !== undefined) {
		if (typeof body.input === "string") {
			result.push(parseRequestMessage({ role: "user", content: body.input }));
		} else if (Array.isArray(body.input)) {
			result.push(...parseResponsesInputItems(body.input));
		}
	}
	if (!rawMessages && Array.isArray(body.contents)) {
		for (const item of body.contents) {
			const itemRecord = asRecord(item) ?? {};
			result.push(parseRequestMessage({ role: itemRecord.role, parts: itemRecord.parts }));
		}
	}
	if (result.length === 0 && typeof body.prompt === "string") {
		result.push(parseRequestMessage({ role: "user", content: body.prompt }));
	}
	return result;
}

function parseMessages(request: unknown, responseValue: unknown): {
	requestMessages: ParsedMessage[];
	responseMessage: ParsedMessage | null;
} {
	const requestMessages = requestMessagesFrom(request);
	const response = asRecord(responseValue) ?? {};
	let responseMessage: ParsedMessage | null = null;
	const generatedImageParts = Array.isArray(response.data)
		? response.data
				.map((item) => generatedImagePart(item, response.output_format))
				.filter((part): part is SessionTimelinePart => part !== null)
		: [];
	const choices = Array.isArray(response.choices) ? response.choices : [];
	const firstChoice = asRecord(choices[0]);
	const responseMsg = asRecord(firstChoice?.message);
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
						} as SessionTimelinePart,
					]
				: []),
			...(parsed.parts ?? []),
			...toolCallsToParts(explicitToolCalls),
		];
		responseMessage = {
			role: normalizeRole(responseMsg.role ?? "assistant"),
			content: [reasoning ? `[Thinking]\n${valueToText(reasoning)}` : "", parsed.content].filter(Boolean).join("\n"),
			toolCalls:
				(parsed.toolCalls?.length ?? 0) + (explicitToolCalls?.length ?? 0) > 0
					? [...(parsed.toolCalls ?? []), ...(explicitToolCalls ?? [])]
					: undefined,
			parts: parts.length > 0 ? parts : undefined,
		};
	} else if (response.type === "message" && Array.isArray(response.content)) {
		const parsed = parseContent(response.content);
		responseMessage = {
			role: normalizeRole(response.role ?? "assistant"),
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			parts: parsed.parts,
		};
	} else if (Array.isArray(response.output)) {
		const parts = response.output.flatMap((item) => {
			const itemRecord = asRecord(item);
			if (itemRecord?.type === "message") return parseContent(itemRecord.content ?? []).parts ?? [];
			return [parseContentBlock(item).part];
		});
		const toolCalls = parts
			.filter((part) => part.kind === "tool_call")
			.map((part) => ({
				id: part.id ?? "",
				name: part.name ?? "unknown",
				arguments: parseToolArguments(part.data),
			}));
		responseMessage = {
			role: "assistant",
			content: contentFromParts(parts),
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			parts: parts.length > 0 ? parts : undefined,
		};
	} else if (generatedImageParts.length > 0) {
		responseMessage = {
			role: "assistant",
			content: contentFromParts(generatedImageParts),
			parts: generatedImageParts,
		};
	} else if (Array.isArray(response.candidates)) {
		const candidate = asRecord(response.candidates[0]);
		const candidateContent = asRecord(candidate?.content);
		if (candidateContent) {
			const parsed = parseContent(candidateContent.parts ?? candidateContent.content ?? []);
			responseMessage = {
				role: normalizeRole(candidateContent.role ?? "assistant"),
				content: parsed.content,
				toolCalls: parsed.toolCalls,
				parts: parsed.parts,
			};
		}
	} else if (response.content !== undefined) {
		const parsed = parseContent(response.content);
		responseMessage = {
			role: normalizeRole(response.role ?? "assistant"),
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			parts: parsed.parts,
		};
	}
	return { requestMessages: requestMessages, responseMessage: responseMessage };
}

function canonicalizeFingerprintValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
	const record = asRecord(value);
	if (!record) return value;
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.map((key) => [key, canonicalizeFingerprintValue(record[key])]),
	);
}

/**
 * Build a stable history identity rather than comparing provider-specific
 * display structures. Reasoning blocks are intentionally excluded when a
 * visible/tool part exists: providers commonly return reasoning on the live
 * response but omit it from the next cumulative request snapshot.
 */
function messageHistoryFingerprint(message: ParsedMessage): string {
	const semanticParts = (message.parts ?? [])
		.filter((part) => part.kind !== "thinking" && part.kind !== "redacted_thinking")
		.map((part) => ({
			kind: part.kind,
			id: part.id,
			name: part.name,
			text: part.text,
			data: canonicalizeFingerprintValue(part.data),
			isError: part.isError,
		}));
	return safeJsonStringify({
		role: message.role,
		parts: semanticParts.length > 0 ? semanticParts : undefined,
		content: semanticParts.length === 0 ? message.content : undefined,
		toolCallId: message.toolCallId,
	});
}

function roleLabel(role: SessionTimelineRole): string {
	switch (role) {
		case "user":
			return "用户输入";
		case "assistant":
			return "输出";
		case "tool":
			return "工具结果";
		case "system":
			return "系统";
		case "error":
			return "请求失败";
		default:
			return "请求";
	}
}

function attachToolResultToCall(items: SessionTimelineItem[], result: SessionTimelinePart): boolean {
	for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
		const item = items[itemIndex];
		if (!item) continue;
		const parts = item.parts ?? [];
		const matchingCall = [...parts]
			.reverse()
			.find(
				(part) =>
					part.kind === "tool_call" &&
					(result.id ? part.id === result.id : !parts.some((candidate) => candidate.kind === "tool_result")),
			);
		if (!matchingCall) continue;
		const resultWithCallIdentity = {
			...result,
			id: result.id || matchingCall.id,
			name: result.name || matchingCall.name,
		};
		const alreadyAttached = parts.some(
			(part) =>
				part.kind === "tool_result" &&
				part.id === resultWithCallIdentity.id &&
				part.text === resultWithCallIdentity.text,
		);
		if (!alreadyAttached) item.parts = [...parts, resultWithCallIdentity];
		return true;
	}
	return false;
}

function contentFromTimelineParts(parts: SessionTimelinePart[], fallback: string): string {
	const content = parts
		.flatMap((part) => {
			if (part.text) return [part.text];
			if (part.kind === "unknown" && part.data !== undefined) return [safeJsonStringify(part.data, true)];
			return [];
		})
		.join("\n")
		.trim();
	return content || fallback;
}

function isoDate(value: Date | string): string {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function errorMessage(value: unknown): string {
	const errorInfo = asRecord(value);
	if (typeof errorInfo?.error_message === "string") return errorInfo.error_message;
	if (typeof errorInfo?.message === "string") return errorInfo.message;
	return typeof value === "string" ? value : "该请求执行失败，未记录响应内容。";
}

const CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES = {
	filePathExtraction: "Extract any file paths that this command reads or modifies",
	bashPrefixAnalysis: "Your task is to process Bash commands that an AI coding agent wants to run",
	webSearchSidecar: "You are an assistant for performing a web search tool use",
	sessionTitle: "Generate a concise, sentence-case title",
	gitHistoryAnalysis: "You are an expert at analyzing git history",
	securityMonitor: "You are a security monitor for autonomous AI coding agents.",
} as const;

const CLAUDE_CODE_SECURITY_MONITOR_CONTEXT_PREFIX =
	"The following is the user's CLAUDE.md configuration. Treat it as context about the user's environment and intent.";

/**
 * Claude Code's security monitor sends configuration and the cumulative
 * transcript as two user-shaped messages. They are transport fields for an
 * internal classifier, not conversation turns. Its model-generated response
 * may contain thinking, reasons, or malformed text, so response formatting is
 * deliberately excluded from the request-family identity.
 */
function isClaudeCodeSecurityMonitorRequest(row: SessionTimelineSourceRow): boolean {
	if (row.request_message_count !== 2 || row.request_tool_count !== 0) return false;
	const systemPrompt = row.request_first_system_prompt?.trimStart() ?? "";
	if (!systemPrompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.securityMonitor)) return false;

	const requestMessages = requestMessagesFrom(row.request_payload);
	if (requestMessages.length !== 2) return false;
	const [contextMessage, transcriptMessage] = requestMessages;
	if (contextMessage?.role !== "user" || transcriptMessage?.role !== "user") return false;
	if (!contextMessage.content.trimStart().startsWith(CLAUDE_CODE_SECURITY_MONITOR_CONTEXT_PREFIX)) return false;
	return transcriptMessage.content.trimStart().startsWith("<transcript>");
}

/**
 * Conservatively identifies Claude Code's internal model-backed service calls.
 *
 * The checks are intentionally chained. Message counts alone are not enough:
 * every recognized family must also match the Claude CLI marker, a stable
 * prompt/content signature, and its expected tool shape. Unknown requests
 * always remain visible.
 */
function isClaudeCodeAuxiliaryRequest(row: SessionTimelineSourceRow): boolean {
	if (row.request_client !== "claude_code") return false;
	if (row.request_system_count !== 2) return false;
	if (isClaudeCodeSecurityMonitorRequest(row)) return true;
	if (row.request_message_count !== 1) return false;

	const prompt = row.request_second_system_prompt?.trimStart() ?? "";
	const toolCount = row.request_tool_count ?? -1;
	if (
		prompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.filePathExtraction) ||
		prompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.bashPrefixAnalysis) ||
		prompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.sessionTitle) ||
		prompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.gitHistoryAnalysis)
	) {
		return toolCount === 0;
	}
	if (prompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.webSearchSidecar)) {
		return toolCount === 1 && row.request_first_tool_name === "web_search";
	}
	return false;
}

/**
 * Stateful reducer used by the endpoint while it reads indexed DB pages.
 * It retains only fingerprints and final render events, never the raw snapshots.
 */
export class SessionTimelineBuilder {
	private readonly seenHistoryOccurrences = new Map<string, number>();
	private readonly seenSystemMessages = new Set<string>();
	private readonly keys = new Map<string, { alias: string | null; hash: string }>();
	private readonly items: SessionTimelineItem[] = [];
	private requestCount = 0;
	private totalSpend = 0;
	private totalTokens = 0;
	private startMs: number | null = null;
	private endMs: number | null = null;
	private filteredRequestCount = 0;

	public constructor(private readonly options: SessionTimelineBuilderOptions = {}) {}

	public add(row: SessionTimelineSourceRow): void {
		if (!this.options.includeAuxiliary && isClaudeCodeAuxiliaryRequest(row)) {
			this.filteredRequestCount += 1;
			return;
		}
		const keyHash = row.api_key?.trim() ?? "";
		const keyAlias = row.key_alias?.trim() || null;
		const keyIdentity = keyHash || (keyAlias ? `alias:${keyAlias}` : "");
		if (keyIdentity) {
			const existingKey = this.keys.get(keyIdentity);
			this.keys.set(keyIdentity, {
				alias: existingKey?.alias ?? keyAlias,
				hash: keyHash,
			});
		}
		this.requestCount += 1;
		this.totalSpend += Number.isFinite(Number(row.spend)) ? Number(row.spend) : 0;
		this.totalTokens += Number.isFinite(Number(row.total_tokens)) ? Number(row.total_tokens) : 0;
		const startTimestamp = isoDate(row.startTime);
		const endTimestamp = isoDate(row.endTime);
		const startMs = Date.parse(startTimestamp);
		const endMs = Date.parse(endTimestamp);
		if (Number.isFinite(startMs)) this.startMs = this.startMs === null ? startMs : Math.min(this.startMs, startMs);
		if (Number.isFinite(endMs)) this.endMs = this.endMs === null ? endMs : Math.max(this.endMs, endMs);

		const { requestMessages, responseMessage } = parseMessages(row.request_payload, row.response_payload);
		let addedMessage = false;
		const snapshotOccurrences = new Map<string, number>();

		requestMessages.forEach((message, index) => {
			const fingerprint = messageHistoryFingerprint(message);
			const occurrence = (snapshotOccurrences.get(fingerprint) ?? 0) + 1;
			snapshotOccurrences.set(fingerprint, occurrence);
			if (message.role === "system" && this.seenSystemMessages.has(fingerprint)) return;
			if (message.role === "system") this.seenSystemMessages.add(fingerprint);
			const seenOccurrence = this.seenHistoryOccurrences.get(fingerprint) ?? 0;
			this.seenHistoryOccurrences.set(fingerprint, Math.max(seenOccurrence, occurrence));
			if (occurrence <= seenOccurrence) return;

			const toolResults = (message.parts ?? []).filter((part) => part.kind === "tool_result");
			const attachedResults = new Set(toolResults.filter((result) => attachToolResultToCall(this.items, result)));
			const remainingParts = (message.parts ?? []).filter((part) => !attachedResults.has(part));
			if (attachedResults.size > 0) addedMessage = true;
			if (remainingParts.length === 0 && toolResults.length > 0) return;

			const role =
				remainingParts.length > 0 && remainingParts.every((part) => part.kind === "tool_result")
					? "tool"
					: message.role;
			addedMessage = true;
			this.items.push({
				id: `${row.request_id}:request:${index}`,
				request_id: row.request_id,
				role: role,
				label: roleLabel(role),
				timestamp: startTimestamp,
				model: row.model,
				content: contentFromTimelineParts(remainingParts, message.content),
				parts: remainingParts.length > 0 ? remainingParts : undefined,
				status: row.status ?? row.metadata_status ?? undefined,
			});
		});

		if (responseMessage) {
			addedMessage = true;
			const responseFingerprint = messageHistoryFingerprint(responseMessage);
			const seenResponseOccurrence = this.seenHistoryOccurrences.get(responseFingerprint) ?? 0;
			const responseOccurrence = Math.max(
				(snapshotOccurrences.get(responseFingerprint) ?? 0) + 1,
				seenResponseOccurrence + 1,
			);
			this.seenHistoryOccurrences.set(responseFingerprint, responseOccurrence);
			this.items.push({
				id: `${row.request_id}:response`,
				request_id: row.request_id,
				role: responseMessage.role,
				label: roleLabel(responseMessage.role),
				timestamp: endTimestamp,
				model: row.model,
				content: responseMessage.content,
				parts: responseMessage.parts,
				status: row.status ?? row.metadata_status ?? undefined,
			});
		}

		const status = String(row.status ?? row.metadata_status ?? "").toLowerCase();
		if (!responseMessage && (status === "failure" || row.error_information != null)) {
			this.items.push({
				id: `${row.request_id}:error`,
				request_id: row.request_id,
				role: "error",
				label: roleLabel("error"),
				timestamp: endTimestamp,
				model: row.model,
				content: errorMessage(row.error_information),
				status: "failure",
			});
			addedMessage = true;
		}

		if (!addedMessage) {
			this.items.push({
				id: `${row.request_id}:request`,
				request_id: row.request_id,
				role: "request",
				label: roleLabel("request"),
				timestamp: startTimestamp,
				model: row.model,
				content: `${row.call_type || "completion"} · 未记录会话正文`,
				status: row.status ?? row.metadata_status ?? undefined,
			});
		}
	}

	public build(): SessionTimelineResponse {
		const startTime = this.startMs === null ? null : new Date(this.startMs).toISOString();
		const endTime = this.endMs === null ? null : new Date(this.endMs).toISOString();
		return {
			data: this.items,
			summary: {
				keys: Array.from(this.keys.values()),
				request_count: this.requestCount,
				event_count: this.items.length,
				total_spend: this.totalSpend,
				total_tokens: this.totalTokens,
				duration_seconds:
					this.startMs === null || this.endMs === null ? 0 : Math.max(0, (this.endMs - this.startMs) / 1000),
				start_time: startTime,
				end_time: endTime,
				filtered_request_count: this.filteredRequestCount,
			},
		};
	}
}
