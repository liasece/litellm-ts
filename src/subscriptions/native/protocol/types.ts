/**
 * 协议转换公共类型。
 *
 * 入口可能是 chat、Anthropic Messages 或 OpenAI Responses；上游额外支持 Gemini。
 * 转换只在协议不一致时发生，同协议请求由桥接层原样透传。
 */

/** SSE 事件中的数据载荷；非 JSON 行（如 [DONE]）保留字符串。 */
export type ProtocolPayload = Record<string, unknown> | string;

/** 一条协议事件；event 对应 SSE 的 event: 字段。 */
export interface ProtocolEvent {
	/** SSE 事件名；chat 流通常没有。 */
	readonly event?: string;
	/** JSON 对象或原始字符串。 */
	readonly data: ProtocolPayload;
}

/** 有状态的流式转换器。 */
export interface ProtocolStreamTranslator {
	/**
	 * 输入一条上游事件，返回零到多条入口协议事件。
	 * @param event - 上游事件
	 */
	push(event: ProtocolEvent): ProtocolEvent[];
	/** 上游结束后冲刷终止事件。 */
	flush(): ProtocolEvent[];
}

/** 请求翻译选项。 */
export interface ProtocolTranslationOptions {
	/** 客户端请求的模型 ID。 */
	readonly model: string;
	/** 上游模型 ID。 */
	readonly upstreamModel: string;
}

/** 流式翻译选项。 */
export interface ProtocolStreamOptions extends ProtocolTranslationOptions {
	/** 是否在 chat 流末尾补 [DONE]。 */
	readonly includeDone?: boolean;
}
