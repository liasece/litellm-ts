/**
 * 费用记录与分析类型
 *
 * 定义花费追踪所需的数据结构和计算接口。
 * 参考: LiteLLM Python litellm/proxy/_types.py
 */

import type { Request } from "express";
import type { ModelResolutionChainEntry } from "../router/ModelResolutionTrace";
import type { UserAPIKeyAuth } from "./auth";
import type { CustomCostPerToken } from "../cost/CostCalculator";

declare global {
	namespace Express {
		interface Request {
			spendRequestId?: string;
			spendSessionId?: string;
		}
	}
}

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
	ATranscription = "atranscription",
	Transcription = "transcription",
	ASpeech = "aspeech",
	Speech = "speech",
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
	/** 原始请求消息，供 WebUI 日志详情抽屉展示 */
	messages?: unknown;
	/** 上游响应体，供 WebUI 日志详情抽屉展示 */
	response?: unknown;
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
	/** 项目 ID */
	project_id?: string;
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
	/** 原始 usage 对象，用于成本和 metadata 透传 */
	usage?: Record<string, unknown>;
	/** Python request_tags 列字段，兼容 tags 别名 */
	request_tags?: string[];
	/** 模型成本映射，用于 service tier 等成本覆盖 */
	model_cost_map?: Record<string, unknown>;
	/**
	 * 实际执行 deployment 的自定义价格（per-token），来自 model_info / litellm_params
	 * （批次 9：对齐 PY register_model 的自定义价格优先路径）。
	 */
	custom_cost_per_token?: CustomCostPerToken;
	/** 失败信息，写入 metadata.error_information */
	error_information?: Record<string, unknown>;
	/** completion token 明细，如 reasoning_tokens */
	completion_tokens_details?: Record<string, unknown>;
}

/** Python SpendLogs metadata JSON 负载。 */
export interface SpendLogsMetadata {
	/** 请求使用的 API key 哈希或 master key 别名 */
	readonly user_api_key?: string;
	/** 请求使用的 API key 别名 */
	readonly user_api_key_alias?: string;
	/** API key 所属团队 ID */
	readonly user_api_key_team_id?: string;
	/** API key 所属项目 ID（PY 键集对齐；项目子系统未实现，恒 null） */
	readonly user_api_key_project_id?: string | null;
	/** API key 所属项目别名（PY 键集对齐；项目子系统未实现，恒 null） */
	readonly user_api_key_project_alias?: string | null;
	/** API key 所属组织 ID */
	readonly user_api_key_org_id?: string;
	/** API key 所属用户 ID */
	readonly user_api_key_user_id?: string;
	/** API key 所属团队别名（LiteLLM_TeamTable.team_alias join 结果） */
	readonly user_api_key_team_alias?: string | null;
	/** 请求体 metadata 经过脱敏后的副本 */
	readonly spend_logs_metadata?: Record<string, unknown>;
	/** 请求来源 IP 地址 */
	readonly requester_ip_address?: string;
	/** usage 中 Python 会额外保存的扩展字段 */
	readonly additional_usage_values?: Record<string, unknown>;
	/** 命中的 guardrail 列表 */
	readonly applied_guardrails?: unknown;
	/** MCP 工具调用元数据 */
	readonly mcp_tool_call_metadata?: unknown;
	/** Vector store 请求元数据 */
	readonly vector_store_request_metadata?: unknown;
	/** Guardrail 执行信息 */
	readonly guardrail_information?: unknown;
	/** 请求最终状态 */
	readonly status?: SpendLogStatus;
	/** Proxy 入口请求信息（PY _get_spend_logs_metadata: 恒 null，完整内容存顶层列） */
	readonly proxy_server_request?: Record<string, unknown> | null;
	/** Batch 请求涉及的模型列表 */
	readonly batch_models?: unknown;
	/** 失败请求的错误信息 */
	readonly error_information?: Record<string, unknown>;
	/** 原始 usage 对象脱敏副本 */
	readonly usage_object?: Record<string, unknown>;
	/** 模型映射信息（PY StandardLoggingModelInformation：model_map_key/model_map_value） */
	readonly model_map_information?: Record<string, unknown> | null;
	/** 冷存储对象键（PY 键集对齐；冷存储子系统未实现，恒 null） */
	readonly cold_storage_object_key?: string | null;
	/** LiteLLM 代理层开销毫秒数（请求进入→上游发起前） */
	readonly litellm_overhead_time_ms?: number | null;
	/** 已尝试重试次数（fallback 链跳数） */
	readonly attempted_retries?: number | null;
	/** 最大允许重试次数（max_fallbacks 配置） */
	readonly max_retries?: number | null;
	/** fallback 链经过的模型名列表（按尝试顺序：原始模型 → fallback1 → ... → 最终模型） */
	readonly fallback_models?: string[] | null;
	/** 实际进入 Router 的各逻辑模型位置对应的 alias 展开路径；无 alias 时为 null。 */
	readonly model_resolution_chain?: ModelResolutionChainEntry[] | null;
	/**
	 * 成本拆分明细（PY CostBreakdown，types/utils.py:2771）。
	 * 由 trackSpendLog 算完 cost 后注入：{input_cost, output_cost, total_cost, tool_usage_cost}。
	 */
	readonly cost_breakdown?: Record<string, unknown> | null;
}

/** 构建 Python 等价 SpendLog 时需要的上下文。 */
export interface SpendLogBuildContext {
	/** Express 请求对象，提供 URL、header、body 和 IP */
	readonly req: Request;
	/** 已认证的 LiteLLM API key 上下文 */
	readonly auth?: UserAPIKeyAuth;
	/** 外部指定 request_id；未指定时生成 UUID */
	readonly requestId?: string;
	/** LiteLLM 调用类型 */
	readonly callType: CallType;
	/** 对用户暴露的模型名 */
	readonly model: string;
	/** 路由模型组名 */
	readonly modelGroup?: string;
	/** 部署模型 ID */
	readonly modelId?: string;
	/** 明确解析出的 provider 名 */
	readonly customLlmProvider?: string;
	/** 上游 API base */
	readonly apiBase?: string;
	/** 请求进入代理的时间 */
	readonly startTime: Date;
	/** 请求完成或失败时间 */
	readonly endTime: Date;
	/** 首个有效流式 chunk 到达时间 */
	readonly completionStartTime?: Date;
	/** 原始请求消息或输入 */
	readonly messages?: unknown;
	/** 上游响应体 */
	readonly response?: unknown;
	/** 上游 usage 对象 */
	readonly usage?: Record<string, unknown>;
	/** 捕获到的请求错误 */
	readonly error?: unknown;
	/** 显式请求状态 */
	readonly status?: SpendLogStatus;
	/** 请求标签 */
	readonly requestTags?: string[];
	/** 模型成本表覆盖 */
	readonly modelCostMap?: Record<string, unknown>;
	/** 实际执行 deployment 的自定义价格（per-token），优先于内置价格表 */
	readonly customCostPerToken?: CustomCostPerToken;
	/**
	 * 实际执行 deployment 的完整模型名（litellm_params.model，含 provider 前缀）。
	 * 供 SpendLogs.model 列按 PY reconstruct_model_name 规则重建
	 * （litellm/litellm_core_utils/core_helpers.py:195）。
	 */
	readonly deploymentModel?: string;
	/**
	 * 代理层开销毫秒数（请求进入→上游发起前），对齐 PY litellm_overhead_time_ms。
	 * 由各端点在派发上游前计算传入。
	 */
	readonly litellmOverheadTimeMs?: number;
	/** 已尝试 fallback 跳数（AnthropicUpstreamDispatch fallbackDepth） */
	readonly attemptedRetries?: number;
	/** fallback 链最大跳数（Router max_fallbacks 配置） */
	readonly maxRetries?: number;
	/** fallback 链经过的模型名列表（按尝试顺序） */
	readonly fallbackModels?: string[];
	/** alias 解析轨迹；SpendTracker 会过滤无 alias/坏条目并防御性复制。 */
	readonly modelResolutionChain?: readonly ModelResolutionChainEntry[];
	/** 响应缓存键（PY 键集对齐；TS 无响应缓存子系统，恒 null） */
	readonly cacheKey?: string;
	/** 响应缓存命中标记（TS 无响应缓存子系统，恒 false） */
	readonly cacheHit?: boolean;
}

/** 单次账务写入结果。duplicate 表示相同 request_id 已由此前事务提交。 */
export interface SpendLogTrackResult {
	/** 提交状态 */
	readonly status: "committed" | "duplicate";
	/** 请求幂等标识 */
	readonly requestId: string;
	/** 本次请求的实际花费 */
	readonly spend: number;
}

/** 可参与费用预留的预算主体类型 */
export type SpendReservationScopeKind = "key" | "user" | "team" | "organization" | "project" | "team_member" | "end_user";

/** 一个独立预算主体；同一请求可同时预留多个主体。 */
export type SpendReservationScope =
	| {
			readonly kind: Exclude<SpendReservationScopeKind, "team_member">;
			readonly id: string;
	  }
	| {
			readonly kind: "team_member";
			readonly userId: string;
			readonly teamId: string;
	  };

/** 单次费用预留请求 */
export interface SpendReservationInput {
	/** 请求幂等标识 */
	readonly requestId: string;
	/** 预留金额 */
	readonly reserved: number;
	/** 需要同时检查和预留的预算主体 */
	readonly scopes: readonly SpendReservationScope[];
}

/** 费用预留账本结果 */
export interface SpendReservationResult {
	/** 当前账本状态 */
	readonly status: "reserved" | "duplicate" | "released" | "settled";
	/** 请求幂等标识 */
	readonly requestId: string;
	/** 预留金额 */
	readonly reserved: number;
	/** 结算金额；尚未结算时为 null */
	readonly actual: number | null;
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
