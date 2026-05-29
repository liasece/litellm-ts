/**
 * 费用记录与分析类型
 *
 * 定义花费追踪所需的数据结构和计算接口。
 * 参考: LiteLLM Python litellm/proxy/_types.py
 */

/**
 * 调用类型枚举（SpendLog.call_type）
 *
 * 对齐 PY litellm.proxy.spend_tracking 的 call_type 字段，标识该 SpendLog 来自哪类入口：
 * - ACompletion: OpenAI 异步 Chat Completions（acompletion 路径）
 * - Completion: OpenAI 同步 Chat Completions
 * - AMessages: Anthropic Messages 异步（amessages 路径）
 * - AEmbedding: 异步 embedding 调用
 * - Embedding: 同步 embedding 调用
 * - AImageGeneration: 异步图像生成
 * - ImageGeneration: 同步图像生成
 */
export enum CallType {
	ACompletion = "acompletion",
	Completion = "completion",
	AMessages = "amessages",
	AEmbedding = "aembedding",
	Embedding = "embedding",
	AImageGeneration = "aimage_generation",
	ImageGeneration = "image_generation",
}

/**
 * SpendLog 最终状态（SpendLog.status）
 *
 * 对齐 PY `litellm/proxy/_types.py` SpendLogsMetadata.status：
 * - Success: 请求成功且 usage 已计费
 * - Failure: 请求失败（含上游错误、cancelled、timeout 等）
 */
export enum SpendLogStatus {
	Success = "success",
	Failure = "failure",
}

/** 单次请求花费日志 */
export interface SpendLog {
	/** 请求唯一标识 */
	request_id: string;
	/** 调用类型（如 acompletion、amessages） */
	call_type: CallType;
	/** 使用的 API 密钥 */
	api_key: string;
	/** 花费金额（美元） */
	spend: number;
	/** 总 token 数 */
	total_tokens: number;
	/** 提示 token 数 */
	prompt_tokens: number;
	/** 补全 token 数 */
	completion_tokens: number;
	/** 请求开始时间 */
	startTime: string;
	/** 请求结束时间 */
	endTime: string;
	/** 首次补全时间（流式响应） */
	completionStartTime?: string;
	/** 模型名称 */
	model: string;
	/** 模型组名称 */
	model_group?: string;
	/** 模型 ID */
	model_id?: string;
	/** 自定义 LLM Provider */
	custom_llm_provider?: string;
	/** API 基础 URL */
	api_base?: string;
	/** 用户标识 */
	user?: string;
	/** 团队 ID */
	team_id?: string;
	/** 密钥别名 */
	key_alias?: string;
	/** 元数据 */
	metadata?: Record<string, unknown>;
	/** 缓存命中 */
	cache_hit?: boolean;
	/** 缓存键 */
	cache_key?: string;
	/** 请求者 IP 地址 */
	requester_ip_address?: string;
	/** Proxy 服务端请求信息 */
	proxy_server_request?: Record<string, unknown>;
	/** 会话 ID */
	session_id?: string;
	/** 请求耗时（ms） */
	request_duration_ms?: number;
	/** 请求状态 */
	status?: SpendLogStatus;
	/** 组织 ID */
	organization_id?: string;
	/** 标签（字符串数组，对齐 PY request_tags JSON.stringify） */
	tags?: string[];
	/** 端用户 ID */
	end_user_id?: string;
	/** 代理 ID */
	agent_id?: string;
	/** MCP 命名空间工具名 */
	mcp_namespaced_tool_name?: string;
	/** 缓存创建输入 tokens */
	cache_creation_input_tokens?: number;
	/** 缓存读取输入 tokens */
	cache_read_input_tokens?: number;
}

/** 每日花费汇总 */
export interface DailySpend {
	/** 记录 ID */
	id: string;
	/** 日期（YYYY-MM-DD） */
	date: string;
	/** API 密钥 */
	api_key: string;
	/** 模型名称 */
	model?: string;
	/** 花费金额（美元） */
	spend: number;
	/** 提示 token 数 */
	prompt_tokens: number;
	/** 补全 token 数 */
	completion_tokens: number;
	/** API 请求次数 */
	api_requests: number;
	/** 用户 ID */
	user_id?: string;
	/** 团队 ID */
	team_id?: string;
}

/** 花费计算请求 */
export interface SpendCalculateRequest {
	/** 模型名称 */
	model: string;
	/** 提示 token 数 */
	prompt_tokens?: number;
	/** 补全 token 数 */
	completion_tokens?: number;
	/** 消息列表（当 token 数未提供时自动计算） */
	messages?: Array<{
		role: string;
		content: string;
	}>;
}

/** 花费计算结果 */
export interface SpendCalculateResponse {
	/** 计算出的花费金额（美元） */
	cost: number;
}
