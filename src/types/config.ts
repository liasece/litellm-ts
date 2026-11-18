/**
 * 模型元信息类型
 *
 * 与 LiteLLM `model_info`（数据库 LiteLLM_ProxyModelTable.model_info 列）对齐；
 * 进程级 config.yaml 不再承载模型配置。
 */

/** 模型元信息 */
export interface ModelInfo {
	/** 模型唯一标识 */
	id?: string;
	/** 强制把该逻辑模型无条件解析为另一个模型组，语义等同 alias。 */
	override_model_name?: string;
	/** 默认思考强度：仅当请求没有指定思考强度时，才映射到各协议的请求字段。 */
	override_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	/** 强制思考强度：无论请求是否指定思考强度，都替换为这里的值。 */
	force_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	/** 模型模式： "chat" | "completion" | "embedding" | "image_generation" | "audio_transcription" | "responses" */
	mode?: string;
	/**
	 * DIFF-ROUTER-EDGE-01: 模型组别名（PY get_model_info(id)["model_name"] 字段）。
	 * 当 deployment 的 model_info.model_name 与 deployment.model_name 不一致时，
	 * Router 按此字段做同组部署匹配（PY router.py:7521-7531 get_model_group）。
	 */
	model_name?: string;
	/** 最大输入 token 数 */
	max_input_tokens?: number;
	/** 最大输出 token 数 */
	max_output_tokens?: number;
	/** 是否支持函数调用 */
	supports_function_calling?: boolean;
	/** 是否支持并行函数调用 */
	supports_parallel_function_calling?: boolean;
	/** 是否支持视觉输入 */
	supports_vision?: boolean;
	/** 为该 deployment 注入的内置能力 ID；能力本身的设置由全局能力管理页维护。 */
	enabled_builtin_capabilities?: string[];
	/** 是否支持 system 消息 */
	supports_system_messages?: boolean;
	/** 是否支持工具选择 */
	supports_tool_choice?: boolean;
	/** 输入 token 单价 */
	input_cost_per_token?: number;
	/** 输出 token 单价 */
	output_cost_per_token?: number;
	/** cache 写入单价（每 token，PY model_info.cache_creation_input_token_cost） */
	cache_creation_input_token_cost?: number;
	/** cache 读取单价（每 token，PY model_info.cache_read_input_token_cost） */
	cache_read_input_token_cost?: number;
	/** Provider 名称 */
	litellm_provider?: string;
	/** 每分钟 token 限制 */
	tpm?: number;
	/** 每分钟请求限制 */
	rpm?: number;
	/** 部署区域（PY 区域过滤用），如 "us-east-1", "eu-west-1" */
	region?: string;
	/** 是否支持 response_format（结构化输出） */
	supports_response_format?: boolean;
	/**
	 * DIFF-ROUTER-EDGE-01: 模型元数据（任意键值对）。PY `model_info.metadata` 字段。
	 * 当前用于解析 `metadata.model_group_name`（PY router.get_model_group 优先级最高）。
	 */
	metadata?: Record<string, unknown>;
	/** 兼容数据库中由 Python LiteLLM 或管理端保存的扩展字段。 */
	[key: string]: unknown;
}
