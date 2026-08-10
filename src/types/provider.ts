/**
 * LLM Provider 抽象层类型
 *
 * 定义统一的 Provider 接口契约，支持 OpenAI、Anthropic、DeepSeek 等多种上游。
 */

import type { Message, ModelResponse, ModelResponseStream } from "./openai";

/**
 * 支持的 LLM Provider 枚举
 *
 * 每个值对应一个上游服务实现：
 * - OpenAI: 标准 OpenAI Chat Completions 协议（含 Azure 兼容路径）
 * - Anthropic: Claude Messages 协议
 * - DeepSeek: 国产 DeepSeek 平台（OpenAI 兼容）
 * - GLM: 智谱 GLM 平台（OpenAI 兼容子集）
 * - MiMo: 小米 MiMo（CN region，自定义协议封装）
 * - MiMoGlobal: 小米 MiMo 海外（OpenAI 兼容）
 * - LLMux: 内部 llmux 多路复用代理
 * - VLLM: 自部署 vLLM 推理服务
 */
export enum LlmProviders {
	OpenAI = "openai",
	Anthropic = "anthropic",
	DeepSeek = "deepseek",
	MiniMax = "minimax",
	GLM = "glm",
	MiMo = "mimo",
	MiMoGlobal = "mimo_global",
	LLMux = "llmux",
	VLLM = "vllm",
	CLIProxy = "cliproxy",
}

/** Provider 实际使用的上游响应协议。 */
export type ProviderResponseProtocol = "chat_completions" | "responses";

/** Provider 请求封装 */
export interface ProviderRequest {
	/** 上游 API URL */
	url: string;
	/** HTTP 方法 */
	method: "POST";
	/** 请求头 */
	headers: Record<string, string>;
	/** 请求体（JSON 序列化前的对象） */
	body: unknown;
	/** Transport encoding. JSON is the default; raw accepts a fetch BodyInit such as FormData. */
	bodyEncoding?: "json" | "raw";
	/** Safe structured representation used by detailed upstream logs instead of a binary body. */
	logBody?: unknown;
	/** 模型名称 */
	model: string;
	/** 是否启用流式响应 */
	stream?: boolean;
	/** 上游响应协议；缺省为 Chat Completions。 */
	responseProtocol?: ProviderResponseProtocol;
}

/** Provider 响应封装 */
export interface ProviderResponse {
	/** HTTP 状态码 */
	statusCode: number;
	/** 响应头 */
	headers: Record<string, string>;
	/** 响应体 */
	body: unknown;
}

/** Provider 配置契约 */
export interface ProviderConfig {
	/**
	 * 将标准请求转换为该 Provider 的请求格式
	 * @param model - 模型名称
	 * @param messages - 消息列表
	 * @param optionalParams - 额外可选参数
	 * @returns ProviderRequest
	 */
	transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest;

	/**
	 * 构造原生 Anthropic Messages 协议请求的连接信息。
	 *
	 * `/v1/messages` 端点使用该能力选择 provider 原生的 Anthropic 出口，
	 * 请求体仍由端点直接透传。未实现时回退到 transformRequest。
	 * @param model - 模型名称
	 * @param optionalParams - deployment 与请求参数
	 */
	transformAnthropicRequest?(model: string, optionalParams: Record<string, unknown>): ProviderRequest;

	/**
	 * 构造原生 OpenAI Responses 请求。
	 *
	 * 返回 undefined 表示当前具体模型不支持原生 Responses，Router 将在同一
	 * deployment/fallback 链内退回 Chat Completions 兼容转换。
	 * @param model - deployment 的实际模型名称
	 * @param body - 已保留 Responses 结构的请求体
	 * @param optionalParams - deployment 与请求连接参数
	 */
	transformResponsesRequest?(
		model: string,
		body: Record<string, unknown>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest | undefined;

	/**
	 * 将标准 embeddings 请求转换为该 Provider 的正式请求格式。
	 * 未实现此能力的 Provider 不支持 embeddings。
	 * @param model - 模型名称
	 * @param input - 原始 embeddings 输入
	 * @param optionalParams - 额外可选参数
	 */
	transformEmbeddingRequest?(model: string, input: unknown, optionalParams: Record<string, unknown>): ProviderRequest;

	/**
	 * 将标准图片生成请求转换为 Provider 的正式请求格式。
	 * 未实现此能力的 Provider 不支持常规 LiteLLM 图片生成链路。
	 * @param model - 模型名称
	 * @param prompt - 图片提示词
	 * @param optionalParams - 图片生成参数
	 */
	transformImageRequest?(model: string, prompt: string, optionalParams: Record<string, unknown>): ProviderRequest;

	/**
	 * Convert a standard image edit request into the provider's multipart protocol.
	 * @param model - Image model name
	 * @param prompt - Editing instructions
	 * @param images - One or more source images
	 * @param optionalParams - Image edit parameters, optionally including a mask
	 */
	transformImageEditRequest?(
		model: string,
		prompt: string,
		images: Array<{ data: Uint8Array; mediaType: string }>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest;

	/**
	 * 将 Provider 原始响应转换为标准 ModelResponse
	 * @param model - 模型名称
	 * @param rawResponse - Provider 原始响应数据
	 * @returns 标准化的 ModelResponse
	 */
	transformResponse(
		model: string,
		rawResponse: unknown,
		usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
	): ModelResponse;

	/**
	 * 获取该 Provider 支持的请求参数列表
	 * @returns 支持的参数名数组
	 */
	getSupportedParams(): string[];

	/**
	 * 是否支持流式响应
	 */
	supportsStreaming(): boolean;

	/**
	 * 从 HTTP Response 流中解析 SSE 数据块
	 * @param response - fetch Response 对象
	 * @returns AsyncGenerator<ModelResponseStream>
	 */
	streamResponse?(response: Response): AsyncGenerator<ModelResponseStream>;
}
