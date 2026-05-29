/**
 * 费用记录与分析类型
 *
 * 定义花费追踪所需的数据结构和计算接口。
 * 参考: LiteLLM Python litellm/proxy/_types.py
 */

/** 单次请求花费日志 */
export interface SpendLog {
	/** 请求唯一标识 */
	request_id: string;
	/** 调用类型（如 "acompletion", "aembedding"） */
	call_type: string;
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
	/** 模型名称 */
	model: string;
	/** 模型组名称 */
	model_group?: string;
	/** 自定义 LLM Provider */
	custom_llm_provider?: string;
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
	/** 会话 ID */
	session_id?: string;
	/** 请求耗时（ms） */
	request_duration_ms?: number;
	/** 请求状态 */
	status?: string;
	/** 组织 ID */
	organization_id?: string;
	/** 标签 */
	tag?: string;
	/** 代理 ID */
	agent_id?: string;
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
