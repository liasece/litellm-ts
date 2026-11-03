import { CONTENT_FIELD_RULES, readFieldRule, reasoningTextFromBlock } from "../core/utils/contentFields";

/**
 * 从内容块按规则表取字段；规则集中在 {@link CONTENT_FIELD_RULES}。
 * @param record - 内容块或消息对象
 * @param rule - 该语义的提取规则
 */
function pickField(record: unknown, rule: { readonly candidates: readonly string[]; readonly fallback?: unknown }): unknown {
	return readFieldRule(record, rule);
}

/** Conversation roles plus synthetic request and error events used by the timeline. */
export type SessionTimelineRole = "system" | "user" | "assistant" | "tool" | "request" | "error";

/** Provider-independent rendering categories for message content blocks. */
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

/** A renderable content block retaining tool identity and provider-specific details. */
export interface SessionTimelinePart {
	/** Rendering category after normalization from the provider's content type. */
	readonly kind: SessionTimelinePartKind;
	/** Display label for the normalized content block. */
	readonly label: string;
	/** Original provider content type, when supplied. */
	readonly sourceType?: string;
	/** Protocol item or tool-call identifier used to correlate related blocks. */
	readonly id?: string;
	/** Tool or operation name when the block identifies one. */
	readonly name?: string;
	/** Human-readable content extracted from the block. */
	readonly text?: string;
	/** Structured arguments, results or other details retained for inspection. */
	readonly data?: unknown;
	/** Provider status associated with this content block. */
	readonly status?: string;
	/** Whether the provider marked this block as a tool error. */
	readonly isError?: boolean;
	/** Nested content blocks, such as the structured content of a tool result. */
	readonly parts?: SessionTimelinePart[];
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

/** Spend-log projection and optional classification metadata consumed by the timeline reducer. */
export interface SessionTimelineSourceRow {
	/** Spend-log request identity used to link timeline events to their request. */
	readonly request_id: string;
	/** Recorded API call type, also used when no conversation body is available. */
	readonly call_type: string;
	/** Key identifier stored with the spend log, used to group the session's keys. */
	readonly api_key?: string | null;
	/** Display alias for the recorded key, when available. */
	readonly key_alias?: string | null;
	/** Recorded request cost added to the visible session total. */
	readonly spend: number;
	/** Recorded request token usage added to the visible session total. */
	readonly total_tokens: number;
	/** Request start time used for input events and the session's earliest boundary. */
	readonly startTime: Date | string;
	/** Request end time used for response events and the session's latest boundary. */
	readonly endTime: Date | string;
	/** Recorded model name shown on each event from this request. */
	readonly model: string;
	/** Spend-log status, taking precedence over the metadata status when present. */
	readonly status: string | null;
	/** Status retained in metadata for records without a top-level status. */
	readonly metadata_status: string | null;
	/** Recorded failure details used when no response message is available. */
	readonly error_information: unknown;
	/** Request body or compacted history containing the messages to reconstruct. */
	readonly request_payload: unknown;
	/** Recorded provider response from which output events are reconstructed. */
	readonly response_payload: unknown;
	/** Recognized client identity used to classify auxiliary requests. */
	readonly request_client?: string | null;
	/** Number of system blocks used to classify known auxiliary request shapes. */
	readonly request_system_count?: number | null;
	/** Original request message count, before history compaction. */
	readonly request_message_count?: number | null;
	/** Number of declared tools used to distinguish auxiliary request families. */
	readonly request_tool_count?: number | null;
	/** First declared tool name used to identify auxiliary web-search requests. */
	readonly request_first_tool_name?: string | null;
	/** Prefix of the first system prompt used for auxiliary request classification. */
	readonly request_first_system_prompt?: string | null;
	/** Prefix of the second system prompt used for auxiliary request classification. */
	readonly request_second_system_prompt?: string | null;
	/** First message role projected for auxiliary classification without loading full history. */
	readonly request_first_message_role?: string | null;
	/** Second message role projected for auxiliary classification without loading full history. */
	readonly request_second_message_role?: string | null;
	/** First message text prefix used to identify security-monitor context. */
	readonly request_first_message_text?: string | null;
	/** Second message text prefix used to identify security-monitor transcripts. */
	readonly request_second_message_text?: string | null;
	/**
	 * Occurrence numbers in the original cumulative request snapshot, aligned
	 * with request_payload after the endpoint has reduced it to unseen messages.
	 */
	readonly request_message_occurrences?: readonly number[];
	/**
	 * Flags aligned with the compact request payload. A true entry came from a
	 * position beyond the previous cumulative high-water mark, so user/tool
	 * content remains a new occurrence even when it intentionally repeats.
	 */
	readonly request_message_delta_flags?: readonly boolean[];
	/** Whether request content is already available, including history intentionally compacted away. */
	readonly request_payload_available?: boolean;
	/** Whether response content is available without a cold-storage lookup. */
	readonly response_payload_available?: boolean;
	/** Internal request category; builtin_capability marks proxy-generated capability calls. */
	readonly internal_call_type?: string | null;
	/** Capability name attached to an internal request, such as vision. */
	readonly builtin_capability?: string | null;
	/** Request identity linking an internal capability call to its parent. */
	readonly parent_request_id?: string | null;
}

/** One visible timeline event reconstructed from a logged request or response. */
export interface SessionTimelineItem {
	/** Stable event identifier derived from its request and position within that request. */
	readonly id: string;
	/** Spend-log request identity used to open the underlying request details. */
	readonly request_id: string;
	/** Conversation role or synthetic event category used for rendering. */
	readonly role: SessionTimelineRole;
	/** Display label for the event's role. */
	readonly label: string;
	/** Serialized request start or end time associated with this event. */
	readonly timestamp: string;
	/** Recorded model name for the request that produced this event. */
	readonly model: string;
	/** Plain-text representation for display when structured parts are unavailable. */
	readonly content: string;
	/** Structured content blocks preserving tool calls, results and multimodal details. */
	parts?: SessionTimelinePart[];
	/** Block-level or request-level status associated with this event. */
	readonly status?: string;
	/** True for proxy-generated built-in capability calls; otherwise omitted. */
	readonly internal_call?: boolean;
	/** Built-in capability that produced this internal event, when applicable. */
	readonly builtin_capability?: string;
	/** Parent request identity for a proxy-generated capability call. */
	readonly parent_request_id?: string;
}

/** Reconstructed events and aggregates for the included requests in a session. */
export interface SessionTimelineResponse {
	/** Events in the order they were added by the timeline reducer. */
	readonly data: SessionTimelineItem[];
	/** Aggregates over included requests, plus the count of filtered auxiliary requests. */
	readonly summary: {
		/** Distinct keys observed among included requests. */
		readonly keys: ReadonlyArray<{
			/** First available display alias for this key, or null. */
			readonly alias: string | null;
			/** Stored key identifier; empty when only a key alias was available. */
			readonly hash: string;
		}>;
		/** Number of requests included after auxiliary filtering. */
		readonly request_count: number;
		/** Number of rendered events; one request may contribute several events. */
		readonly event_count: number;
		/** Sum of finite recorded costs for included requests. */
		readonly total_spend: number;
		/** Sum of finite recorded token counts for included requests. */
		readonly total_tokens: number;
		/** Span from earliest included start to latest included end, in seconds. */
		readonly duration_seconds: number;
		/** Earliest valid included request start time, or null. */
		readonly start_time: string | null;
		/** Latest valid included request end time, or null. */
		readonly end_time: string | null;
		/** Number of auxiliary requests omitted from both events and aggregates. */
		readonly filtered_request_count: number;
	};
}

/** Controls whether recognized client-side auxiliary requests appear in the timeline. */
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

function internalTimelineFields(
	row: SessionTimelineSourceRow,
): Pick<SessionTimelineItem, "internal_call" | "builtin_capability" | "parent_request_id"> {
	const internalCall = row.internal_call_type === "builtin_capability";
	return {
		internal_call: internalCall || undefined,
		builtin_capability: internalCall ? row.builtin_capability ?? undefined : undefined,
		parent_request_id: internalCall ? row.parent_request_id ?? undefined : undefined,
	};
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
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}
				const itemRecord = asRecord(item);
				if (typeof itemRecord?.text === "string") {
					return itemRecord.text;
				}
				return safeJsonStringify(item, true);
			})
			.filter(Boolean)
			.join("\n");
	}
	const record = asRecord(value);
	if (typeof record?.text === "string") {
		return record.text;
	}
	return value === null || value === undefined ? "" : safeJsonStringify(value, true);
}

function toolCallPart(
	block: Record<string, unknown>,
	label: string,
	name: unknown,
	args: unknown,
): { part: SessionTimelinePart; toolCall: ToolCall } {
	const toolCall = {
		id: String(pickField(block, CONTENT_FIELD_RULES.toolCallId) || ""),
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

/**
 * 取出 reasoning 块的可读文本；与日志详情页共用同一套挑选规则。
 * @param block - 原始 reasoning/thinking 块
 */
function reasoningText(block: Record<string, unknown>): string {
	return reasoningTextFromBlock(block);
}

function imageMimeType(value: unknown): string {
	if (typeof value !== "string") {
		return "image/png";
	}
	const normalized = value.trim().toLowerCase();
	if (normalized.startsWith("image/")) {
		return normalized;
	}
	if (normalized === "jpg" || normalized === "jpeg") {
		return "image/jpeg";
	}
	if (normalized === "webp") {
		return "image/webp";
	}
	if (normalized === "gif") {
		return "image/gif";
	}
	return "image/png";
}

function imageSource(value: unknown, mimeType: string, base64 = false): string | undefined {
	if (typeof value !== "string" || !value.trim()) {
		return undefined;
	}
	const source = value.trim();
	if (source.includes("litellm_truncated")) {
		return undefined;
	}
	if (/^(?:data:image\/|https?:\/\/)/i.test(source)) {
		return source;
	}
	return base64 ? `data:${mimeType};base64,${source}` : undefined;
}

const TRUNCATED_IMAGE_MESSAGE = "图片数据在日志入库时被截断，无法显示。";

function generatedImagePart(value: unknown, outputFormat?: unknown, sourceType = "image_generation"): SessionTimelinePart | null {
	const image = asRecord(value);
	if (!image) {
		return null;
	}
	const mimeType = imageMimeType(image.mime_type ?? image.mimeType ?? outputFormat);
	const imageUrl = asRecord(image.image_url);
	const encodedImage = image.b64_json ?? image.result;
	const wasTruncated = typeof encodedImage === "string" && encodedImage.includes("litellm_truncated");
	const source =
		imageSource(image.b64_json, mimeType, true) ??
		imageSource(image.result, mimeType, true) ??
		imageSource(imageUrl?.url ?? image.image_url ?? image.url, mimeType);
	if (!source && !wasTruncated) {
		return null;
	}
	return {
		kind: "image",
		label: "Generated image",
		sourceType: sourceType,
		id: typeof image.id === "string" ? image.id : undefined,
		status: typeof image.status === "string" ? image.status : undefined,
		text: wasTruncated
			? TRUNCATED_IMAGE_MESSAGE
			: typeof image.revised_prompt === "string"
				? image.revised_prompt
				: undefined,
		data: source ? { src: source, mimeType: mimeType } : { truncated: true },
	};
}

function structuredToolResultParts(value: unknown): SessionTimelinePart[] | undefined {
	let structured = value;
	if (typeof value === "string" && (value.trimStart().startsWith("[") || value.trimStart().startsWith("{"))) {
		try {
			structured = JSON.parse(value) as unknown;
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
		!blocks.every((block) => {
			if (typeof block === "string") {
				return true;
			}
			const blockRecord = asRecord(block);
			return Boolean(
				blockRecord?.type ||
				blockRecord?.functionCall ||
				blockRecord?.functionResponse ||
				blockRecord?.inlineData ||
				blockRecord?.inline_data ||
				blockRecord?.fileData ||
				blockRecord?.file_data,
			);
		})
	) {
		return undefined;
	}
	return blocks.map((block) => parseContentBlock(block).part);
}

function toolResultSummary(parts: SessionTimelinePart[]): string {
	return parts
		.map((part) => {
			if (part.kind === "image") {
				const data = asRecord(part.data);
				return data?.truncated === true ? TRUNCATED_IMAGE_MESSAGE : "[Image]";
			}
			if (part.kind === "thinking") {
				return `[Thinking]\n${part.text ?? ""}`.trim();
			}
			if (part.kind === "redacted_thinking") {
				return "[Redacted thinking]";
			}
			return part.text ?? (part.data !== undefined ? safeJsonStringify(part.data, true) : "");
		})
		.filter(Boolean)
		.join("\n");
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
		const result = functionResponse.response;
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: "Function result",
				sourceType: "functionResponse",
				name: typeof functionResponse.name === "string" ? functionResponse.name : undefined,
				text: parts ? toolResultSummary(parts) : valueToText(result),
				data: result,
				parts: parts,
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

	const media = asRecord(pickField(block, CONTENT_FIELD_RULES.inlineMedia));
	if (media) {
		const mimeType = imageMimeType(media.mimeType ?? media.mime_type);
		const source = imageSource(media.data, mimeType, true) ?? imageSource(media.fileUri ?? media.file_uri, mimeType);
		return {
			part: {
				kind: "image",
				label: "Media",
				sourceType: block.inlineData ?? block.inline_data ? "inlineData" : "fileData",
				text: String(media.mimeType ?? media.mime_type ?? media.fileUri ?? media.file_uri ?? "Attached media"),
				data: source ? { src: source, mimeType: mimeType } : undefined,
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
		const text = reasoningText(block);
		// Anthropic 的加密思考块带 signature 但 thinking 为空：内容不可见，标成已隐藏，
		// 避免渲染出一个空的思考区。
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
			pickField(block, CONTENT_FIELD_RULES.toolName),
			pickField(block, CONTENT_FIELD_RULES.toolArguments),
		);
	}
	if (
		["tool_result", "function_call_output", "custom_tool_call_output", "mcp_call_output", "computer_call_output"].includes(
			type,
		)
	) {
		const result = pickField(block, CONTENT_FIELD_RULES.toolResult);
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: type === "tool_result" ? "Tool result" : "Function result",
				sourceType: type,
				id: String(pickField(block, CONTENT_FIELD_RULES.toolCallId) || ""),
				name: typeof block.name === "string" ? block.name : undefined,
				text: parts ? toolResultSummary(parts) : valueToText(result),
				data: result !== null && typeof result === "object" ? result : undefined,
				status: typeof block.status === "string" ? block.status : undefined,
				isError: block.is_error === true || block.status === "failed" || block.status === "error",
				parts: parts,
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
				text: valueToText(pickField(block, CONTENT_FIELD_RULES.webSearchText)),
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
				text: valueToText(pickField(block, CONTENT_FIELD_RULES.code)),
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
				text: valueToText(pickField(block, CONTENT_FIELD_RULES.codeResult)),
			},
		};
	}
	if (type === "image_generation_call") {
		const generated = generatedImagePart(block, block.output_format, type);
		if (generated) {
			return { part: generated };
		}
	}
	if (["image", "image_url", "input_image", "output_image"].includes(type)) {
		const imageData = asRecord(block.source);
		const mimeType = imageMimeType(pickField(block, CONTENT_FIELD_RULES.imageMimeType));
		const rawSource = pickField(block, CONTENT_FIELD_RULES.imageSource);
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
				text: wasTruncated ? TRUNCATED_IMAGE_MESSAGE : valueToText(source ?? rawSource ?? block.file_id ?? "Attached image"),
				data: source ? { src: source, mimeType: mimeType } : wasTruncated ? { truncated: true } : undefined,
			},
		};
	}
	if (["document", "input_file", "file"].includes(type)) {
		return {
			part: {
				kind: "document",
				label: "Document",
				sourceType: type,
				text: valueToText(pickField(block, CONTENT_FIELD_RULES.documentLabel)),
			},
		};
	}
	if (["audio", "input_audio", "output_audio"].includes(type)) {
		return { part: { kind: "audio", label: "Audio", sourceType: type, text: "Audio content" } };
	}
	if (type === "refusal") {
		return {
			part: { kind: "refusal", label: "Refusal", sourceType: type, text: valueToText(pickField(block, CONTENT_FIELD_RULES.refusal)) },
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
			if (part.kind === "thinking") {
				return `[Thinking]\n${part.text ?? ""}`.trim();
			}
			if (part.kind === "redacted_thinking") {
				return "[Redacted thinking]";
			}
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
		if (content === null || content === undefined) {
			return { content: "" };
		}
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
	if (!Array.isArray(value)) {
		return undefined;
	}
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
	if (role === "model") {
		return "assistant";
	}
	if (role === "developer") {
		return "system";
	}
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
				parts: parsed.parts,
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
	if (parts.length === 0) {
		return Boolean(message.content.trim());
	}
	return parts.some((part) => {
		if (["text", "thinking", "tool_result", "refusal"].includes(part.kind)) {
			return Boolean(part.text?.trim());
		}
		if (part.kind === "unknown") {
			return part.data !== undefined && part.data !== null;
		}
		return true;
	});
}

/**
 * OpenAI Responses stores cumulative history as a heterogeneous input-item
 * stream, not as Chat Completions messages. Tool calls, tool outputs and
 * reasoning therefore need roles inferred from their item type. The
 * additional_tools item is only a client tool registry and is not a turn.
 * @param items - Responses input items in their original history order.
 */
function parseResponsesInputItems(items: unknown[]): ParsedMessage[] {
	const result: ParsedMessage[] = [];
	for (const item of items) {
		if (typeof item === "string") {
			const message = parseRequestMessage({ role: "user", content: item });
			if (hasRenderableMessageContent(message)) {
				result.push(message);
			}
			continue;
		}

		const itemRecord = asRecord(item);
		if (!itemRecord) {
			continue;
		}
		const type = typeof itemRecord.type === "string" ? itemRecord.type : "";
		if (type === "additional_tools") {
			continue;
		}

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
		if (hasRenderableMessageContent(message)) {
			result.push(message);
		}
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
			if (itemRecord?.type === "message") {
				return parseContent(itemRecord.content ?? []).parts ?? [];
			}
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
	if (Array.isArray(value)) {
		return value.map(canonicalizeFingerprintValue);
	}
	const record = asRecord(value);
	if (!record) {
		return value;
	}
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
 * @param message - Normalized message whose semantic content identifies a history occurrence.
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

function toolResultWithCallIdentity(items: SessionTimelineItem[], result: SessionTimelinePart): SessionTimelinePart {
	for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
		const item = items[itemIndex];
		if (!item) {
			continue;
		}
		const parts = item.parts ?? [];
		const matchingCall = [...parts]
			.reverse()
			.find(
				(part) =>
					part.kind === "tool_call" &&
					(result.id ? part.id === result.id : !parts.some((candidate) => candidate.kind === "tool_result")),
			);
		if (!matchingCall) {
			continue;
		}
		return {
			...result,
			id: result.id || matchingCall.id,
			name: result.name || matchingCall.name,
		};
	}
	return result;
}

function contentFromTimelineParts(parts: SessionTimelinePart[], fallback: string): string {
	const content = parts
		.flatMap((part) => {
			if (part.text) {
				return [part.text];
			}
			if (part.kind === "unknown" && part.data !== undefined) {
				return [safeJsonStringify(part.data, true)];
			}
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
	if (typeof errorInfo?.error_message === "string") {
		return errorInfo.error_message;
	}
	if (typeof errorInfo?.message === "string") {
		return errorInfo.message;
	}
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
 * @param row - Logged request with projected classification fields or its original payload.
 */
function isClaudeCodeSecurityMonitorRequest(row: SessionTimelineSourceRow): boolean {
	if (row.request_message_count !== 2 || row.request_tool_count !== 0) {
		return false;
	}
	const systemPrompt = row.request_first_system_prompt?.trimStart() ?? "";
	if (!systemPrompt.startsWith(CLAUDE_CODE_AUXILIARY_PROMPT_PREFIXES.securityMonitor)) {
		return false;
	}

	if (
		row.request_first_message_role != null ||
		row.request_second_message_role != null ||
		row.request_first_message_text != null ||
		row.request_second_message_text != null
	) {
		return (
			row.request_first_message_role === "user" &&
			row.request_second_message_role === "user" &&
			(row.request_first_message_text ?? "").trimStart().startsWith(CLAUDE_CODE_SECURITY_MONITOR_CONTEXT_PREFIX) &&
			(row.request_second_message_text ?? "").trimStart().startsWith("<transcript>")
		);
	}

	const requestMessages = requestMessagesFrom(row.request_payload);
	if (requestMessages.length !== 2) {
		return false;
	}
	const [contextMessage, transcriptMessage] = requestMessages;
	if (contextMessage?.role !== "user" || transcriptMessage?.role !== "user") {
		return false;
	}
	if (!contextMessage.content.trimStart().startsWith(CLAUDE_CODE_SECURITY_MONITOR_CONTEXT_PREFIX)) {
		return false;
	}
	return transcriptMessage.content.trimStart().startsWith("<transcript>");
}

/**
 * Conservatively identifies Claude Code's internal model-backed service calls.
 *
 * The checks are intentionally chained. Message counts alone are not enough:
 * every recognized family must also match the Claude CLI marker, a stable
 * prompt/content signature, and its expected tool shape. Unknown requests
 * always remain visible.
 * @param row - Timeline source row with compact request classification fields.
 */
export function isClaudeCodeAuxiliaryTimelineRequest(row: SessionTimelineSourceRow): boolean {
	if (row.request_client !== "claude_code") {
		return false;
	}
	if (row.request_system_count !== 2) {
		return false;
	}
	if (isClaudeCodeSecurityMonitorRequest(row)) {
		return true;
	}
	if (row.request_message_count !== 1) {
		return false;
	}

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
	private readonly _seenHistoryOccurrences = new Map<string, number>();
	private readonly _seenSystemMessages = new Set<string>();
	private readonly _keys = new Map<string, { alias: string | null; hash: string }>();
	private readonly _items: SessionTimelineItem[] = [];
	private _requestCount = 0;
	private _totalSpend = 0;
	private _totalTokens = 0;
	private _startMs: number | null = null;
	private _endMs: number | null = null;
	private _filteredRequestCount = 0;

	public constructor(private readonly _options: SessionTimelineBuilderOptions = {}) {}

	/**
	 * Add a request in chronological order, removing cumulative history already represented.
	 * @param row - Logged request and optional compact-history classification metadata.
	 */
	public add(row: SessionTimelineSourceRow): void {
		if (!this._options.includeAuxiliary && isClaudeCodeAuxiliaryTimelineRequest(row)) {
			this._filteredRequestCount += 1;
			return;
		}
		const keyHash = row.api_key?.trim() ?? "";
		const keyAlias = row.key_alias?.trim() || null;
		const keyIdentity = keyHash || (keyAlias ? `alias:${keyAlias}` : "");
		if (keyIdentity) {
			const existingKey = this._keys.get(keyIdentity);
			this._keys.set(keyIdentity, {
				alias: existingKey?.alias ?? keyAlias,
				hash: keyHash,
			});
		}
		this._requestCount += 1;
		this._totalSpend += Number.isFinite(Number(row.spend)) ? Number(row.spend) : 0;
		this._totalTokens += Number.isFinite(Number(row.total_tokens)) ? Number(row.total_tokens) : 0;
		const startTimestamp = isoDate(row.startTime);
		const endTimestamp = isoDate(row.endTime);
		const startMs = Date.parse(startTimestamp);
		const endMs = Date.parse(endTimestamp);
		if (Number.isFinite(startMs)) {
			this._startMs = this._startMs === null ? startMs : Math.min(this._startMs, startMs);
		}
		if (Number.isFinite(endMs)) {
			this._endMs = this._endMs === null ? endMs : Math.max(this._endMs, endMs);
		}

		const { requestMessages, responseMessage } = parseMessages(row.request_payload, row.response_payload);
		let addedMessage = false;
		const snapshotOccurrences = new Map<string, number>();

		requestMessages.forEach((message, index) => {
			const fingerprint = messageHistoryFingerprint(message);
			const snapshotOccurrence = (snapshotOccurrences.get(fingerprint) ?? 0) + 1;
			const suppliedOccurrence = row.request_message_occurrences?.[index];
			let occurrence =
				typeof suppliedOccurrence === "number" && Number.isSafeInteger(suppliedOccurrence) && suppliedOccurrence > 0
					? Math.max(snapshotOccurrence, suppliedOccurrence)
					: snapshotOccurrence;
			const seenOccurrence = this._seenHistoryOccurrences.get(fingerprint) ?? 0;
			if (row.request_message_delta_flags?.[index]) {
				// A copied assistant response is already represented by the
				// preceding response event. Other tail positions are genuine new
				// history occurrences, including intentionally repeated user text.
				occurrence =
					(message.role === "assistant" || message.role === "system") && seenOccurrence > 0
						? seenOccurrence
						: seenOccurrence + 1;
			}
			snapshotOccurrences.set(fingerprint, Math.max(snapshotOccurrence, occurrence));
			if (message.role === "system" && this._seenSystemMessages.has(fingerprint)) {
				return;
			}
			if (message.role === "system") {
				this._seenSystemMessages.add(fingerprint);
			}
			this._seenHistoryOccurrences.set(fingerprint, Math.max(seenOccurrence, occurrence));
			if (occurrence <= seenOccurrence) {
				return;
			}

			const messageParts = message.parts ?? [];
			const toolResults = messageParts.filter((part) => part.kind === "tool_result");
			const remainingParts = messageParts.filter((part) => part.kind !== "tool_result");

			toolResults.forEach((result, resultIndex) => {
				const identifiedResult = toolResultWithCallIdentity(this._items, result);
				this._items.push({
					id: `${row.request_id}:request:${index}:tool-result:${resultIndex}`,
					request_id: row.request_id,
					role: "tool",
					label: roleLabel("tool"),
					timestamp: startTimestamp,
					model: row.model,
					content: contentFromTimelineParts([identifiedResult], message.content),
					parts: [identifiedResult],
					status: identifiedResult.status ?? row.status ?? row.metadata_status ?? undefined,
					...internalTimelineFields(row),
				});
				addedMessage = true;
			});

			if (remainingParts.length > 0 || (messageParts.length === 0 && message.content.trim())) {
				const role = message.role;
				addedMessage = true;
				this._items.push({
					id: `${row.request_id}:request:${index}`,
					request_id: row.request_id,
					role: role,
					label: roleLabel(role),
					timestamp: startTimestamp,
					model: row.model,
					content: contentFromTimelineParts(remainingParts, message.content),
					parts: remainingParts.length > 0 ? remainingParts : undefined,
					status: row.status ?? row.metadata_status ?? undefined,
					...internalTimelineFields(row),
				});
			}
		});

		if (responseMessage) {
			addedMessage = true;
			const responseFingerprint = messageHistoryFingerprint(responseMessage);
			const seenResponseOccurrence = this._seenHistoryOccurrences.get(responseFingerprint) ?? 0;
			const responseOccurrence = Math.max(
				(snapshotOccurrences.get(responseFingerprint) ?? 0) + 1,
				seenResponseOccurrence + 1,
			);
			this._seenHistoryOccurrences.set(responseFingerprint, responseOccurrence);
			const responseParts = responseMessage.parts ?? [];
			const toolResults = responseParts.filter((part) => part.kind === "tool_result");
			const remainingParts = responseParts.filter((part) => part.kind !== "tool_result");
			if (remainingParts.length > 0 || (responseParts.length === 0 && responseMessage.content.trim())) {
				this._items.push({
					id: `${row.request_id}:response`,
					request_id: row.request_id,
					role: responseMessage.role,
					label: roleLabel(responseMessage.role),
					timestamp: endTimestamp,
					model: row.model,
					content:
						toolResults.length > 0
							? contentFromParts(remainingParts) || responseMessage.content
							: responseMessage.content,
					parts: remainingParts.length > 0 ? remainingParts : undefined,
					status: row.status ?? row.metadata_status ?? undefined,
					...internalTimelineFields(row),
				});
			}
			toolResults.forEach((result, resultIndex) => {
				const identifiedResult = toolResultWithCallIdentity(this._items, result);
				this._items.push({
					id: `${row.request_id}:response:tool-result:${resultIndex}`,
					request_id: row.request_id,
					role: "tool",
					label: roleLabel("tool"),
					timestamp: endTimestamp,
					model: row.model,
					content: contentFromTimelineParts([identifiedResult], responseMessage.content),
					parts: [identifiedResult],
					status: identifiedResult.status ?? row.status ?? row.metadata_status ?? undefined,
					...internalTimelineFields(row),
				});
			});
		}

		const status = String(row.status ?? row.metadata_status ?? "").toLowerCase();
		if (!responseMessage && (status === "failure" || row.error_information != null)) {
			this._items.push({
				id: `${row.request_id}:error`,
				request_id: row.request_id,
				role: "error",
				label: roleLabel("error"),
				timestamp: endTimestamp,
				model: row.model,
				content: errorMessage(row.error_information),
				status: "failure",
				...internalTimelineFields(row),
			});
			addedMessage = true;
		}

		if (!addedMessage) {
			this._items.push({
				id: `${row.request_id}:request`,
				request_id: row.request_id,
				role: "request",
				label: roleLabel("request"),
				timestamp: startTimestamp,
				model: row.model,
				content: `${row.call_type || "completion"} · 未记录会话正文`,
				status: row.status ?? row.metadata_status ?? undefined,
				...internalTimelineFields(row),
			});
		}
	}

	/** Return the accumulated events and totals; the returned data array remains owned by this builder. */
	public build(): SessionTimelineResponse {
		const startTime = this._startMs === null ? null : new Date(this._startMs).toISOString();
		const endTime = this._endMs === null ? null : new Date(this._endMs).toISOString();
		return {
			data: this._items,
			summary: {
				keys: Array.from(this._keys.values()),
				request_count: this._requestCount,
				event_count: this._items.length,
				total_spend: this._totalSpend,
				total_tokens: this._totalTokens,
				duration_seconds:
					this._startMs === null || this._endMs === null ? 0 : Math.max(0, (this._endMs - this._startMs) / 1000),
				start_time: startTime,
				end_time: endTime,
				filtered_request_count: this._filteredRequestCount,
			},
		};
	}
}
