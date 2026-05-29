/**
 * Anthropic Messages API SSE 流式事件类型
 *
 * 参考: Anthropic Messages API SDK 类型定义
 */

/** Anthropic 内容块 */
export interface AnthropicContentBlock {
	/** 内容块类型： "text" | "tool_use" | "thinking" | "redacted_thinking" | "server_tool_use" | "compaction" 等 */
	type: string;
	/** 文本内容（text 类型时存在） */
	text?: string;
	/** 内容块 ID（tool_use 类型时存在） */
	id?: string;
	/** 工具名称（tool_use 类型时存在） */
	name?: string;
	/** 工具调用参数（tool_use 类型时存在） */
	input?: Record<string, unknown>;
	/** 思考内容（thinking 类型时存在） */
	thinking?: string;
	/** 签名（thinking / redacted_thinking 类型时存在） */
	signature?: string;
	/** 引用（text 类型时可存在） */
	citations?: Array<Record<string, unknown>>;
}

/** message_start 事件的 message 对象 */
export interface AnthropicMessageStartMessage {
	/** 消息唯一标识符 */
	id: string;
	/** 消息类型，固定为 "message" */
	type: string;
	/** 角色，固定为 "assistant" */
	role: string;
	/** 模型名称 */
	model: string;
	/** 内容块列表 */
	content: AnthropicContentBlock[];
	/** Token 用量 */
	usage: {
		/** 输入 token 数 */
		input_tokens: number;
		/** 输出 token 数 */
		output_tokens: number;
	};
}

/** message_start 事件 */
export interface AnthropicMessageStartEvent {
	/** SSE 事件类型，固定为 "message_start" */
	type: "message_start";
	/** 消息起始信息 */
	message: AnthropicMessageStartMessage;
}

/** content_block_start 事件 */
export interface ContentBlockStartEvent {
	/** SSE 事件类型，固定为 "content_block_start" */
	type: "content_block_start";
	/** 内容块索引 */
	index: number;
	/** 内容块 */
	content_block: AnthropicContentBlock;
}

/** content_block_delta 事件 */
export interface ContentBlockDeltaEvent {
	/** SSE 事件类型，固定为 "content_block_delta" */
	type: "content_block_delta";
	/** 内容块索引 */
	index: number;
	/** delta 变化内容 */
	delta: {
		/** delta 类型： "text_delta" | "input_json_delta" | "thinking_delta" | "signature_delta" */
		type: string;
		/** 文本增量 */
		text?: string;
		/** JSON 增量片段 */
		partial_json?: string;
		/** 思考增量 */
		thinking?: string;
		/** 签名 */
		signature?: string;
	};
}

/** content_block_stop 事件 */
export interface ContentBlockStopEvent {
	/** SSE 事件类型，固定为 "content_block_stop" */
	type: "content_block_stop";
	/** 内容块索引 */
	index: number;
}

/** message_delta 事件 */
export interface MessageDeltaEvent {
	/** SSE 事件类型，固定为 "message_delta" */
	type: "message_delta";
	/** delta 信息 */
	delta: {
		/** 停止原因： "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" */
		stop_reason: string;
		/** 触发的停止序列文本 */
		stop_sequence?: string;
	};
	/** 累积用量 */
	usage: {
		/** 输出 token 数 */
		output_tokens: number;
	};
}

/** message_stop 事件 */
export interface MessageStopEvent {
	/** SSE 事件类型，固定为 "message_stop" */
	type: "message_stop";
}

/** ping 事件 */
export interface PingEvent {
	/** SSE 事件类型，固定为 "ping" */
	type: "ping";
}

/** Anthropic SSE 流式事件联合类型 */
export type AnthropicSSEEvent =
	| AnthropicMessageStartEvent
	| ContentBlockStartEvent
	| ContentBlockDeltaEvent
	| ContentBlockStopEvent
	| MessageDeltaEvent
	| MessageStopEvent
	| PingEvent;
