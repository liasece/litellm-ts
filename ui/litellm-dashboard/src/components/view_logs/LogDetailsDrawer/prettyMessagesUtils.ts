/*
 * Utility functions for parsing and formatting messages for pretty view
 */

import { ParsedMessage, ParsedMessages, RoleStyle, ToolCall } from "./prettyMessagesTypes";

/**
 * Role color styles for message cards - minimal, professional design
 * Color only used for labels and left border accent
 */
export const ROLE_STYLES: Record<string, RoleStyle> = {
	system: {
		background: "transparent",
		borderColor: "#8c8c8c",
		label: "SYSTEM",
		labelColor: "#8c8c8c",
	},
	user: {
		background: "transparent",
		borderColor: "#1677ff",
		label: "USER",
		labelColor: "#1677ff",
	},
	assistant: {
		background: "transparent",
		borderColor: "#52c41a",
		label: "ASSISTANT",
		labelColor: "#52c41a",
	},
	tool: {
		background: "transparent",
		borderColor: "#fa8c16",
		label: "TOOL RESULT",
		labelColor: "#fa8c16",
	},
};

const safeJsonStringify = (value: any): string => {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return "[Unserializable content]";
	}
};

const formatUnknownBlock = (block: any): string => {
	const blockType =
		block !== null && typeof block === "object" && typeof block.type === "string" ? block.type : "unknown";
	return `[Unknown block: ${blockType}]\n${safeJsonStringify(block)}`;
};

const formatAnthropicContentBlock = (block: any): string | null => {
	if (block !== null && typeof block === "object") {
		if (block.type === "text" && typeof block.text === "string") {
			return block.text;
		}
		if (block.type === "thinking") {
			return typeof block.thinking === "string" && block.thinking.length > 0
				? `[Thinking]\n${block.thinking}`
				: "[Thinking]";
		}
		if (block.type === "redacted_thinking") {
			return "[Redacted thinking]";
		}
		if (block.type === "tool_use" || block.type === "server_tool_use") {
			return null;
		}
	}

	return formatUnknownBlock(block);
};

const aggregateAnthropicContentBlocks = (blocks: any[]): { content: string; toolCalls?: ToolCall[] } => {
	const contentParts: string[] = [];
	const toolCalls: ToolCall[] = [];

	blocks.forEach((block) => {
		if (
			block !== null &&
			typeof block === "object" &&
			(block.type === "tool_use" || block.type === "server_tool_use")
		) {
			toolCalls.push({
				id: block.id || "",
				name: block.name || "unknown",
				arguments: parseToolArguments(block.input),
			});
			return;
		}

		const formattedBlock = formatAnthropicContentBlock(block);
		if (formattedBlock !== null) {
			contentParts.push(formattedBlock);
		}
	});

	return {
		content: contentParts.join("\n"),
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
};

/**
 * Parse request messages and response message from log data
 */
export const parseMessages = (request: any, response: any): ParsedMessages => {
	const requestMessages: ParsedMessage[] = [];
	const requestMessageSource = Array.isArray(request?.body?.messages)
		? request.body.messages
		: Array.isArray(request?.messages)
			? request.messages
			: [];

	requestMessageSource.forEach((msg: any) => {
		requestMessages.push({
			role: msg.role || "user",
			content: parseMessageContent(msg.content),
			toolCallId: msg.tool_call_id,
		});
	});

	let responseMessage: ParsedMessage | null = null;
	const responseMsg = response?.choices?.[0]?.message;

	if (responseMsg) {
		responseMessage = {
			role: responseMsg.role || "assistant",
			content: responseMsg.content || "",
			toolCalls: parseToolCalls(responseMsg.tool_calls),
		};
	} else if (response?.type === "message" && Array.isArray(response.content)) {
		const parsedContent = aggregateAnthropicContentBlocks(response.content);
		responseMessage = {
			role: response.role || "assistant",
			content: parsedContent.content,
			toolCalls: parsedContent.toolCalls,
		};
	} else if (response?.output && Array.isArray(response.output)) {
		// OpenAI Responses API format: response.output[].content[].text
		const msgItem = response.output.find((item: any) => item.type === "message");
		if (msgItem) {
			const textParts = (msgItem.content || [])
				.filter((item: any) => item.type === "output_text" && item.text)
				.map((item: any) => item.text);
			responseMessage = {
				role: msgItem.role || "assistant",
				content: textParts.join("\n") || "",
			};
		}
	}

	return { requestMessages, responseMessage };
};

/**
 * Parse message content - handle strings and content arrays (for vision, etc.)
 */
const parseMessageContent = (content: any): string => {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") return item;
				if (item !== null && typeof item === "object" && item.type === "image_url") {
					return "[Image]";
				}
				return formatAnthropicContentBlock(item) ?? "";
			})
			.join("\n");
	}

	return safeJsonStringify(content);
};

/**
 * Parse tool calls from response message
 */
const parseToolCalls = (toolCalls: any[]): ToolCall[] | undefined => {
	if (!toolCalls || !Array.isArray(toolCalls)) return undefined;

	return toolCalls.map((toolCall) => ({
		id: toolCall.id || "",
		name: toolCall.function?.name || "unknown",
		arguments: parseToolArguments(toolCall.function?.arguments),
	}));
};

/**
 * Parse tool arguments - handle both string and object formats
 */
const parseToolArguments = (args: any): Record<string, any> => {
	if (typeof args === "string") {
		try {
			return JSON.parse(args);
		} catch {
			return { raw: args };
		}
	}

	if (args !== null && typeof args === "object") {
		return args;
	}

	return args === null || args === undefined ? {} : { raw: args };
};
