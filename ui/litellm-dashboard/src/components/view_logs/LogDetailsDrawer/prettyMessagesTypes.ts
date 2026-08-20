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
	/** Structured content returned by a tool (for example text plus an image). */
	parts?: MessagePart[];
}

export interface ParsedMessages {
	requestMessages: ParsedMessage[];
	responseMessage: ParsedMessage | null;
}

/**
 * 请求级元信息，用于 pretty 视图顶部的 tag 行。
 * 从请求体（body）中提取思考强度、工具列表等关键参数。
 */
export interface RequestMeta {
	model?: string;
	/** OpenAI reasoning_effort 或 DeepSeek reasoning.effort，如 "low" | "medium" | "high" | "max" */
	reasoningEffort?: string;
	/** Anthropic thinking.budget_tokens，思考预算 token 数 */
	thinkingBudget?: number;
	/** 请求中声明的工具名列表 */
	tools: string[];
	temperature?: number;
	topP?: number;
	maxTokens?: number;
	/** 请求体 stream 字段；true 表示下游要求流式响应 */
	stream?: boolean;
}

export interface RoleStyle {
	background: string;
	borderColor: string;
	label: string;
	labelColor: string;
}
