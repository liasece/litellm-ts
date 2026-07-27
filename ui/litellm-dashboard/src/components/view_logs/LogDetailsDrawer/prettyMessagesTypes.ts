/**
 * Type definitions for pretty messages view
 */

export interface ParsedMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
	parts?: MessagePart[];
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export type MessagePartKind =
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

export interface MessagePart {
	kind: MessagePartKind;
	label: string;
	sourceType?: string;
	id?: string;
	name?: string;
	text?: string;
	data?: any;
	status?: string;
	isError?: boolean;
}

export interface ParsedMessages {
	requestMessages: ParsedMessage[];
	responseMessage: ParsedMessage | null;
}

export interface RoleStyle {
	background: string;
	borderColor: string;
	label: string;
	labelColor: string;
}
