import type { MessagePart, RoleStyle, ToolCall } from "../support/PrettyMessagesModels";
import { PRETTY_FIELD_RULES, readFieldRule, type FieldRule } from "./PrettyMessagesFieldRules";
export const stringValue = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const ROLE_STYLES: Record<string, RoleStyle> = {
	system: { background: "transparent", borderColor: "#8c8c8c", label: "SYSTEM", labelColor: "#8c8c8c" },
	user: { background: "transparent", borderColor: "#1677ff", label: "USER", labelColor: "#1677ff" },
	assistant: { background: "transparent", borderColor: "#52c41a", label: "ASSISTANT", labelColor: "#52c41a" },
	tool: { background: "transparent", borderColor: "#fa8c16", label: "TOOL RESULT", labelColor: "#fa8c16" },
};

export const safeJsonStringify = (value: unknown, pretty = false): string => {
	try {
		const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return "[Unserializable content]";
	}
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const parseToolArguments = (args: unknown): Record<string, unknown> => {
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
export const pickField = (record: unknown, rule: FieldRule): unknown => readFieldRule(record, rule);

export const valueToText = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") return item;
				if (typeof asRecord(item)?.text === "string") return String(asRecord(item)?.text);
				return safeJsonStringify(item, true);
			})
			.filter(Boolean)
			.join("\n");
	}
	if (typeof asRecord(value)?.text === "string") return String(asRecord(value)?.text);
	return value === null || value === undefined ? "" : safeJsonStringify(value, true);
};

const toolCallPart = (
	block: Record<string, unknown>,
	label: string,
	name: unknown,
	args: unknown,
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
			sourceType: stringValue(block.type),
			id: toolCall.id,
			name: toolCall.name,
			data: toolCall.arguments,
			status: typeof block.status === "string" ? block.status : undefined,
		},
		toolCall,
	};
};

const imageMimeType = (value: unknown): string => {
	if (typeof value !== "string") return "image/png";
	const normalized = value.trim().toLowerCase();
	if (normalized.startsWith("image/")) return normalized;
	if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
	if (normalized === "webp") return "image/webp";
	if (normalized === "gif") return "image/gif";
	return "image/png";
};

const imageSource = (value: unknown, mimeType: string, base64 = false): string | undefined => {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const source = value.trim();
	if (source.includes("litellm_truncated")) return undefined;
	if (/^(?:data:image\/|https?:\/\/)/i.test(source)) return source;
	return base64 ? `data:${mimeType};base64,${source}` : undefined;
};

const TRUNCATED_IMAGE_MESSAGE = "图片数据在日志入库时被截断，无法显示。";

export const generatedImagePart = (value: unknown, outputFormat?: unknown, sourceType = "image_generation"): MessagePart | null => {
	const image = asRecord(value);
	if (!image) return null;
	const mimeType = imageMimeType(pickField(image, PRETTY_FIELD_RULES.imageMimeType) ?? outputFormat);
	const encodedImage = image.b64_json ?? image.result;
	const wasTruncated = typeof encodedImage === "string" && encodedImage.includes("litellm_truncated");
	const source =
		imageSource(image.b64_json, mimeType, true) ??
		imageSource(image.result, mimeType, true) ??
		imageSource(asRecord(image.image_url)?.url ?? image.image_url ?? image.url, mimeType);
	if (!source && !wasTruncated) return null;
	return {
		kind: "image",
		label: "Generated image",
		sourceType,
		id: typeof image.id === "string" ? image.id : undefined,
		status: typeof image.status === "string" ? image.status : undefined,
		text: wasTruncated ? TRUNCATED_IMAGE_MESSAGE : typeof image.revised_prompt === "string" ? image.revised_prompt : undefined,
		data: source ? { src: source, mimeType } : { truncated: true },
	};
};

const structuredToolResultParts = (value: unknown): MessagePart[] | undefined => {
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
			(block: unknown) =>
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
	return blocks.map((block: unknown) => parseContentBlock(block).part);
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

export function parseContentBlock(rawBlock: unknown): { part: MessagePart; toolCall?: ToolCall } {
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
		const functionCall = asRecord(block.functionCall)!;
		return toolCallPart(block, "Function call", functionCall.name, functionCall.args);
	}
	if (asRecord(block.functionResponse)) {
		const functionResponse = asRecord(block.functionResponse)!;
		const result = functionResponse.response;
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: "Function result",
				sourceType: "functionResponse",
				name: stringValue(functionResponse.name),
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
				label: `Executable code${asRecord(block.executableCode)?.language ? ` · ${asRecord(block.executableCode)?.language}` : ""}`,
				sourceType: "executableCode",
				text: valueToText(asRecord(block.executableCode)?.code),
			},
		};
	}
	if (asRecord(block.codeExecutionResult)) {
		return {
			part: {
				kind: "code_result",
				label: "Code result",
				sourceType: "codeExecutionResult",
				status: stringValue(asRecord(block.codeExecutionResult)?.outcome),
				text: valueToText(asRecord(block.codeExecutionResult)?.output),
				data: block.codeExecutionResult,
			},
		};
	}
	if (block.inlineData || block.inline_data || block.fileData || block.file_data) {
		const media = asRecord(block.inlineData || block.inline_data || block.fileData || block.file_data);
		const mimeType = imageMimeType(media?.mimeType ?? media?.mime_type);
		const source = imageSource(media?.data, mimeType, true) ?? imageSource(media?.fileUri ?? media?.file_uri, mimeType);
		return {
			part: {
				kind: "image",
				label: "Media",
				sourceType: block.inlineData || block.inline_data ? "inlineData" : "fileData",
				text: String(media?.mimeType || media?.mime_type || media?.fileUri || media?.file_uri || "Attached media"),
				data: source ? { src: source, mimeType } : undefined,
			},
		};
	}

	const type = typeof block.type === "string" ? block.type : "";
	if (["text", "input_text", "output_text"].includes(type) || (!type && typeof block.text === "string")) {
		if (block.thought === true) {
			return { part: { kind: "thinking", label: "Thinking", sourceType: type || "thought", text: valueToText(block.text) } };
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
	if (["tool_result", "function_call_output", "custom_tool_call_output", "mcp_call_output", "computer_call_output"].includes(type)) {
		const result = pickField(block, PRETTY_FIELD_RULES.toolResult);
		const parts = structuredToolResultParts(result);
		return {
			part: {
				kind: "tool_result",
				label: type === "tool_result" ? "Tool result" : "Function result",
				sourceType: type,
				id: String(pickField(block, PRETTY_FIELD_RULES.toolCallId) || ""),
				name: stringValue(block.name),
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
				status: stringValue(block.status),
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
				status: stringValue(block.status),
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
				status: stringValue(block.status),
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
				status: stringValue(block.status),
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
				status: stringValue(block.status ?? block.outcome),
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
				text: wasTruncated ? TRUNCATED_IMAGE_MESSAGE : valueToText(source ?? rawSource ?? block.file_id ?? "Attached image"),
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
