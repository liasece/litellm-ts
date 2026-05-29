/**
 * OpenAI 兼容响应类型
 *
 * LiteLLM 统一使用这些类型作为所有 LLM 提供商的标准化输出格式。
 * 参考: LiteLLM Python litellm/types/utils.py
 */

/** 思考块 — Anthropic 思考/加密思考内容 */
export interface ThinkingBlock {
	/** 思考块类型 */
	type: "thinking" | "redacted_thinking";
	/** 思考内容 */
	thinking: string;
	/** 签名 */
	signature: string;
}

/** 工具调用参数 */
export interface ToolCallFunction {
	/** 函数名称 */
	name: string;
	/** JSON 编码的函数调用参数 */
	arguments: string;
}

/** 非流式工具调用 */
export interface ToolCall {
	/** 工具调用 ID */
	id: string;
	/** 固定为 "function" */
	type: "function";
	/** 函数调用详情 */
	function: ToolCallFunction;
}

/** 流式工具调用增量 */
export interface ToolCallDeltaFunction {
	/** 函数名称（仅在首个 delta 中出现） */
	name?: string;
	/** 参数增量（JSON 片段） */
	arguments?: string;
}

/** 流式工具调用片段 */
export interface ToolCallDelta {
	/** 工具调用索引，用于多工具调用时关联 */
	index: number;
	/** 工具调用 ID（仅在首个 delta 中出现） */
	id?: string;
	/** 固定为 "function" */
	type?: "function";
	/** 函数调用增量 */
	function?: ToolCallDeltaFunction;
}

/** 非流式函数调用 */
export interface FunctionCall {
	/** 函数名称 */
	name: string;
	/** JSON 编码的函数调用参数 */
	arguments: string;
}

/** 完成 Token 详情 */
export interface TokenDetails {
	/** 推理 token 数 */
	reasoning_tokens?: number;
	/** 音频 token 数（输出） */
	audio_tokens?: number;
	/** 文本 token 数（输出） */
	text_tokens?: number;
	/** 图片 token 数（输出） */
	image_tokens?: number;
}

/** 缓存创建 Token 详情 */
export interface CacheCreationTokenDetails {
	/** 5 分钟有效期的缓存输入 token 数 */
	ephemeral_5m_input_tokens?: number;
	/** 1 小时有效期的缓存输入 token 数 */
	ephemeral_1h_input_tokens?: number;
}

/** 提示 Token 详情 */
export interface PromptTokenDetails {
	/** 缓存命中 token 数 */
	cached_tokens?: number;
	/** 缓存创建 token 数 */
	cache_creation_tokens?: number;
	/** 缓存创建详情 */
	cache_creation_token_details?: CacheCreationTokenDetails;
	/** 文本 token 数（输入） */
	text_tokens?: number;
	/** 图片 token 数（输入） */
	image_tokens?: number;
	/** 音频 token 数（输入） */
	audio_tokens?: number;
	/** 视频 token 数（输入） */
	video_tokens?: number;
}

/** Token 用量统计 */
export interface Usage {
	/** 提示 token 数 */
	prompt_tokens: number;
	/** 补全 token 数 */
	completion_tokens: number;
	/** 总 token 数 */
	total_tokens: number;
	/** 请求费用（美元），由 LiteLLM 计算 */
	cost?: number;
	/** 补全 token 详情 */
	completion_tokens_details?: TokenDetails;
	/** 提示 token 详情 */
	prompt_tokens_details?: PromptTokenDetails;
	/** 缓存创建 input tokens（Anthropic） */
	cache_creation_input_tokens?: number;
	/** 缓存读取 input tokens（Anthropic） */
	cache_read_input_tokens?: number;
}

/** 非流式响应消息 */
export interface Message {
	/** 消息内容（null 表示工具调用等无文本回复） */
	content: string | null;
	/** 角色 */
	role: string;
	/** 工具调用列表 */
	tool_calls?: ToolCall[];
	/** 函数调用（已弃用） */
	function_call?: FunctionCall;
	/** 推理内容（如 DeepSeek R1 的思考过程） */
	reasoning_content?: string;
	/** 思考块（Anthropic） */
	thinking_blocks?: ThinkingBlock[];
}

/** 非流式响应选择 */
export interface Choices {
	/** 结束原因： "stop" | "length" | "tool_calls" | "content_filter" 等 */
	finish_reason: string;
	/** 选择索引 */
	index: number;
	/** 响应消息 */
	message: Message;
	/** logprobs 信息 */
	logprobs?: unknown;
}

/** 流式 delta 消息 */
export interface Delta {
	/** 消息内容增量 */
	content?: string | null;
	/** 角色 */
	role?: string;
	/** 工具调用增量 */
	tool_calls?: ToolCallDelta[];
	/** 推理内容增量 */
	reasoning_content?: string;
	/** 思考块（Anthropic 流式） */
	thinking_blocks?: ThinkingBlock[];
	/** Provider 特定字段（web_search_results, tool_results, compaction_blocks 等） */
	provider_specific_fields?: Record<string, unknown>;
}

/** 流式响应选择 */
export interface StreamingChoices {
	/** 结束原因（null 表示尚未结束） */
	finish_reason: string | null;
	/** 选择索引 */
	index: number;
	/** 消息增量 */
	delta: Delta;
}

/** 非流式 Chat Completion 响应 */
export interface ModelResponse {
	/** 唯一标识符 */
	id: string;
	/** 创建时间（Unix 时间戳，秒） */
	created: number;
	/** 使用的模型名称 */
	model: string;
	/** 对象类型，固定为 "chat.completion" */
	object: string;
	/** 系统指纹 */
	system_fingerprint?: string;
	/** 响应选择列表 */
	choices: Choices[];
	/** Token 用量统计 */
	usage?: Usage;
	/** LiteLLM 内部隐藏参数 */
	_hidden_params?: Record<string, unknown>;
}

/** 流式 Chat Completion Chunk 响应 */
export interface ModelResponseStream {
	/** 唯一标识符 */
	id: string;
	/** 创建时间 */
	created: number;
	/** 使用的模型名称 */
	model: string;
	/** 对象类型，固定为 "chat.completion.chunk" */
	object: string;
	/** 流式响应选择列表 */
	choices: StreamingChoices[];
}
