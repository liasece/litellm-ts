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
 * 请求体 tools[] 中的一个工具定义，已归一到可展示的字段。
 * 供应商形状差异（OpenAI function.*、Responses 扁平字段、Anthropic input_schema）在
 * prettyMessagesUtils 里统一处理。
 */
export interface RequestTool {
	/** 工具名；没有名字的供应商内置工具（如 web_search）回退为声明的 type */
	name: string;
	/** 供应商声明的类型，OpenAI chat 为 function，Anthropic 内置工具是 web_search_20250305 等 */
	type: string;
	description?: string;
	/** 参数 schema：OpenAI function.parameters 或 Anthropic input_schema，原样保留 */
	parameters?: unknown;
	/** 以上字段之外的原始定义字段（如 max_uses、strict），保证展开后不丢信息 */
	extra?: Record<string, unknown>;
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
	/** 请求中声明的工具定义，顺序与请求一致 */
	tools: RequestTool[];
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
