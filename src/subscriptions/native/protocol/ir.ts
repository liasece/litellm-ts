/**
 * 协议转换的规范化中间表示（IR）。
 *
 * 入口协议请求先解码为 {@link CanonicalRequest}，再按上游协议编码；上游响应
 * 与 SSE 事件同理。三种入口协议与四种上游协议因此只需要各自实现一对编解码，
 * 而不必维护完整的 3×4 组合矩阵。
 *
 * IR 只保留可跨协议表达的语义；协议私有字段（工具命名空间、签名等）由
 * Provider 钩子处理，不进入这里。
 */

import type { ProtocolEvent } from "./types";

/** Anthropic 风格的 cache_control 标记。 */
export interface CanonicalCacheControl {
	/** 缓存类型；Anthropic 目前只接受 ephemeral。 */
	readonly type: string;
	/** 可选存活时间。 */
	readonly ttl?: string;
}

/** 文本片段。 */
export interface CanonicalTextPart {
	/** 片段类型。 */
	readonly type: "text";
	/** 文本内容。 */
	readonly text: string;
	/** 提示缓存标记。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 图片片段；URL 可以是 data URL 或远程地址。 */
export interface CanonicalImagePart {
	/** 片段类型。 */
	readonly type: "image";
	/** data URL 或远程 URL。 */
	readonly url: string;
	/** 展示细节偏好，如 auto/low/high。 */
	readonly detail?: string;
	/** 提示缓存标记。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 文档/文件片段。 */
export interface CanonicalDocumentPart {
	/** 片段类型。 */
	readonly type: "document";
	/** data URL；与 fileId/text 三选一。 */
	readonly url?: string;
	/** 已上传文件 ID。 */
	readonly fileId?: string;
	/** 纯文本内容。 */
	readonly text?: string;
	/** 媒体类型。 */
	readonly mediaType?: string;
	/** 文件名或标题。 */
	readonly title?: string;
	/** 提示缓存标记。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 模型思考片段。 */
export interface CanonicalThinkingPart {
	/** 片段类型。 */
	readonly type: "thinking";
	/** 思考文本。 */
	readonly text: string;
	/** 上游签名；缺失时不回放给要求签名的上游。 */
	readonly signature?: string;
	/** 是否为 redacted thinking。 */
	readonly redacted?: boolean;
}

/** 模型拒答片段。 */
export interface CanonicalRefusalPart {
	/** 片段类型。 */
	readonly type: "refusal";
	/** 拒答文本。 */
	readonly text: string;
}

/** 助手发起的工具调用。 */
export interface CanonicalToolCallPart {
	/** 片段类型。 */
	readonly type: "tool_call";
	/** 调用 ID。 */
	readonly id: string;
	/** 工具名。 */
	readonly name: string;
	/** 参数 JSON 字符串。 */
	readonly arguments: string;
	/** Gemini thought signature；只由 Gemini 响应产生，其它目标不得回放。 */
	readonly signature?: string;
}

/** 工具执行结果。 */
export interface CanonicalToolResultPart {
	/** 片段类型。 */
	readonly type: "tool_result";
	/** 对应的工具调用 ID。 */
	readonly toolCallId: string;
	/** 结果内容。 */
	readonly content: readonly CanonicalContentPart[];
	/** 工具是否执行失败。 */
	readonly isError?: boolean;
	/** 提示缓存标记。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 可出现在消息里的内容片段。 */
export type CanonicalContentPart =
	| CanonicalTextPart
	| CanonicalImagePart
	| CanonicalDocumentPart
	| CanonicalThinkingPart
	| CanonicalRefusalPart
	| CanonicalToolCallPart
	| CanonicalToolResultPart;

/** 消息角色；system 消息在编码时并入顶层系统提示。 */
export type CanonicalMessageRole = "system" | "user" | "assistant" | "tool";

/** 一条规范化消息。 */
export interface CanonicalMessage {
	/** 角色。 */
	readonly role: CanonicalMessageRole;
	/** 内容片段，保持原始顺序。 */
	readonly parts: readonly CanonicalContentPart[];
	/** 消息级 cache_control。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 工具定义。 */
export interface CanonicalTool {
	/** 工具名。 */
	readonly name: string;
	/** 描述。 */
	readonly description?: string;
	/** JSON Schema 参数。 */
	readonly parameters?: Record<string, unknown>;
	/** 是否要求严格 schema。 */
	readonly strict?: boolean;
	/** 提示缓存标记。 */
	readonly cacheControl?: CanonicalCacheControl;
}

/** 工具选择模式。 */
export type CanonicalToolChoiceMode = "auto" | "none" | "required" | "tool";

/** 工具选择。 */
export interface CanonicalToolChoice {
	/** 模式。 */
	readonly mode: CanonicalToolChoiceMode;
	/** mode 为 tool 时的工具名。 */
	readonly name?: string;
	/** 允许调用的工具名集合（Anthropic allowed_tools 等扩展）。 */
	readonly allowedNames?: readonly string[];
	/** 是否禁止并行调用。 */
	readonly disableParallelToolUse?: boolean;
}

/** 思考配置。 */
export interface CanonicalReasoningConfig {
	/** 是否启用；undefined 表示沿上游默认。 */
	readonly enabled?: boolean;
	/** 归一化后的档位，如 low/medium/high。 */
	readonly effort?: string;
	/** Anthropic 的 token 预算。 */
	readonly budgetTokens?: number;
	/** Responses 的摘要模式。 */
	readonly summary?: string;
}

/** 结构化输出配置。 */
export type CanonicalResponseFormat =
	| {
			/** 纯文本。 */
			readonly type: "text";
	  }
	| {
			/** 任意 JSON 对象。 */
			readonly type: "json_object";
	  }
	| {
			/** JSON Schema。 */
			readonly type: "json_schema";
			/** schema 名称。 */
			readonly name?: string;
			/** JSON Schema。 */
			readonly schema?: unknown;
			/** 是否严格校验。 */
			readonly strict?: boolean;
	  };

/** 跨协议可安全携带的请求扩展字段。 */
export interface CanonicalRequestExtras {
	/** 终端用户标识。 */
	readonly user?: string;
	/** 随机种子。 */
	readonly seed?: number;
	/** 候选数量。 */
	readonly n?: number;
	/** 存在惩罚。 */
	readonly presencePenalty?: number;
	/** 频率惩罚。 */
	readonly frequencyPenalty?: number;
	/** token 偏置。 */
	readonly logitBias?: Record<string, unknown>;
	/** 是否返回 logprobs。 */
	readonly logprobs?: boolean;
	/** 返回的 top logprobs 数量。 */
	readonly topLogprobs?: number;
	/** 提示缓存键。 */
	readonly promptCacheKey?: string;
	/** Responses 是否存储响应。 */
	readonly store?: boolean;
	/** Responses 截断策略。 */
	readonly truncation?: string;
	/** Responses 额外输出项。 */
	readonly include?: readonly string[];
	/** 服务档位。 */
	readonly serviceTier?: string;
	/** Responses 文本详略程度。 */
	readonly textVerbosity?: string;
	/** Gemini 安全设置。 */
	readonly safetySettings?: readonly Record<string, unknown>[];
	/** Gemini 候选数量。 */
	readonly candidateCount?: number;
	/** Gemini 响应模态。 */
	readonly responseModalities?: readonly string[];
	/** Gemini 缓存内容名。 */
	readonly cachedContent?: string;
	/** 音频输出配置。 */
	readonly audio?: Record<string, unknown>;
}

/** 规范化后的请求。 */
export interface CanonicalRequest {
	/** 请求模型（入口模型 ID）。 */
	readonly model: string;
	/** 顶层系统提示片段。 */
	readonly system: readonly CanonicalContentPart[];
	/** 对话消息。 */
	readonly messages: readonly CanonicalMessage[];
	/** 工具定义。 */
	readonly tools: readonly CanonicalTool[];
	/** 工具选择。 */
	readonly toolChoice?: CanonicalToolChoice;
	/** 是否允许并行工具调用。 */
	readonly parallelToolCalls?: boolean;
	/** 最大输出 token。 */
	readonly maxTokens?: number;
	/** 温度。 */
	readonly temperature?: number;
	/** 核采样。 */
	readonly topP?: number;
	/** top-k 采样。 */
	readonly topK?: number;
	/** 停止序列。 */
	readonly stop: readonly string[];
	/** 是否流式。 */
	readonly stream?: boolean;
	/** 请求元数据。 */
	readonly metadata?: Record<string, unknown>;
	/** 思考配置。 */
	readonly reasoning?: CanonicalReasoningConfig;
	/** 结构化输出配置。 */
	readonly responseFormat?: CanonicalResponseFormat;
	/** Responses 的上一轮响应 ID。 */
	readonly previousResponseId?: string;
	/** 扩展字段。 */
	readonly extras: CanonicalRequestExtras;
}

/** 归一化后的 token 用量。 */
export interface CanonicalUsage {
	/** 输入 token，包含缓存命中与写入。 */
	readonly inputTokens: number;
	/** 输出 token。 */
	readonly outputTokens: number;
	/** 总 token。 */
	readonly totalTokens: number;
	/** 缓存命中 token。 */
	readonly cachedTokens?: number;
	/** 缓存写入 token。 */
	readonly cacheCreationTokens?: number;
	/** 思考 token。 */
	readonly reasoningTokens?: number;
}

/** 归一化后的结束原因。 */
export type CanonicalFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error";

/** 规范化后的非流式响应。 */
export interface CanonicalResponse {
	/** 响应 ID。 */
	readonly id: string;
	/** 创建时间（秒）。 */
	readonly createdAt: number;
	/** 模型 ID。 */
	readonly model: string;
	/** 助手内容片段，保持顺序。 */
	readonly parts: readonly CanonicalContentPart[];
	/** 结束原因。 */
	readonly finishReason: CanonicalFinishReason;
	/** 命中的停止序列。 */
	readonly stopSequence?: string;
	/** token 用量。 */
	readonly usage: CanonicalUsage;
}

/** 流开始事件。 */
export interface CanonicalStreamStart {
	/** 事件类型。 */
	readonly type: "start";
	/** 响应 ID。 */
	readonly id: string;
	/** 模型 ID。 */
	readonly model: string;
	/** 创建时间（秒）。 */
	readonly createdAt: number;
	/** 已知的初始用量。 */
	readonly usage?: CanonicalUsage;
}

/** 正文增量。 */
export interface CanonicalStreamTextDelta {
	/** 事件类型。 */
	readonly type: "text_delta";
	/** 文本增量。 */
	readonly text: string;
}

/** 拒答增量。 */
export interface CanonicalStreamRefusalDelta {
	/** 事件类型。 */
	readonly type: "refusal_delta";
	/** 拒答文本增量。 */
	readonly text: string;
}

/** 思考增量。 */
export interface CanonicalStreamThinkingDelta {
	/** 事件类型。 */
	readonly type: "thinking_delta";
	/** 思考文本增量。 */
	readonly text: string;
}

/** 思考签名增量。 */
export interface CanonicalStreamThinkingSignature {
	/** 事件类型。 */
	readonly type: "thinking_signature";
	/** 签名。 */
	readonly signature: string;
}

/** 工具调用开始。 */
export interface CanonicalStreamToolCallStart {
	/** 事件类型。 */
	readonly type: "tool_call_start";
	/** 逻辑工具序号。 */
	readonly index: number;
	/** 调用 ID。 */
	readonly id: string;
	/** 工具名。 */
	readonly name: string;
}

/** 工具参数增量。 */
export interface CanonicalStreamToolCallDelta {
	/** 事件类型。 */
	readonly type: "tool_call_arguments";
	/** 逻辑工具序号。 */
	readonly index: number;
	/** 参数 JSON 片段。 */
	readonly delta: string;
}

/** 工具调用结束。 */
export interface CanonicalStreamToolCallStop {
	/** 事件类型。 */
	readonly type: "tool_call_stop";
	/** 逻辑工具序号。 */
	readonly index: number;
}

/** 用量更新。 */
export interface CanonicalStreamUsage {
	/** 事件类型。 */
	readonly type: "usage";
	/** 用量。 */
	readonly usage: CanonicalUsage;
}

/** 正常结束。 */
export interface CanonicalStreamFinish {
	/** 事件类型。 */
	readonly type: "finish";
	/** 结束原因。 */
	readonly reason: CanonicalFinishReason;
	/** 命中的停止序列。 */
	readonly stopSequence?: string;
}

/** 上游错误。 */
export interface CanonicalStreamError {
	/** 事件类型。 */
	readonly type: "error";
	/** 错误类型。 */
	readonly errorType: string;
	/** 错误信息。 */
	readonly message: string;
}

/** 心跳。 */
export interface CanonicalStreamPing {
	/** 事件类型。 */
	readonly type: "ping";
}

/** 规范化流事件。 */
export type CanonicalStreamEvent =
	| CanonicalStreamStart
	| CanonicalStreamTextDelta
	| CanonicalStreamRefusalDelta
	| CanonicalStreamThinkingDelta
	| CanonicalStreamThinkingSignature
	| CanonicalStreamToolCallStart
	| CanonicalStreamToolCallDelta
	| CanonicalStreamToolCallStop
	| CanonicalStreamUsage
	| CanonicalStreamFinish
	| CanonicalStreamError
	| CanonicalStreamPing;

/** 上游事件解码器。 */
export interface CanonicalStreamDecoder {
	/**
	 * 解码一条上游事件。
	 * @param event - 上游 SSE 事件
	 */
	decode(event: ProtocolEvent): CanonicalStreamEvent[];
}

/** 入口事件编码器。 */
export interface CanonicalStreamEncoder {
	/**
	 * 编码一条规范事件。
	 * @param event - 规范事件
	 */
	encode(event: CanonicalStreamEvent): ProtocolEvent[];
	/** 上游结束后冲刷终止帧。 */
	flush(): ProtocolEvent[];
}

/** 转换选项（内部使用）。 */
export interface CanonicalTranslationOptions {
	/** 客户端请求的模型 ID。 */
	readonly model: string;
	/** 上游模型 ID。 */
	readonly upstreamModel: string;
}

/** 流式转换选项（内部使用）。 */
export interface CanonicalStreamOptions extends CanonicalTranslationOptions {
	/** 是否在 chat 流末尾补 [DONE]。 */
	readonly includeDone?: boolean;
}
