/**
 * OpenAI 兼容 Provider 基类
 *
 * 作为 DeepSeek、vLLM、MiMo 等 OpenAI 兼容 API 的基类。
 * 处理标准 OpenAI 格式的请求/响应转换、SSE 流解析。
 */

import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { ModelResponse, ModelResponseStream, ToolCall } from "../types/openai";
import { generateChatCompletionId } from "../types/openai";

/** 默认支持的 OpenAI 参数列表 */
const EMBEDDING_SUPPORTED_PARAMS = ["encoding_format", "dimensions", "user"] as const;

const SUPPORTED_PARAMS = [
	"temperature",
	"max_tokens",
	"max_completion_tokens",
	"stream",
	"tools",
	"tool_choice",
	"top_p",
	"stop",
	"n",
	"logprobs",
	"stream_options",
	"frequency_penalty",
	"presence_penalty",
	"logit_bias",
	"user",
	"seed",
	"response_format",
	// GAP (GLM-001): 显式支持 thinking / reasoning_effort，PY ZAI supports_reasoning 暴露
	"thinking",
	"reasoning_effort",
	"cache_control",
	// DIFF-OPENAI-01: 补充 PY `gpt_transformation.map_openai_params` 中支持的字段
	"parallel_tool_calls",
	"service_tier",
	"modalities",
	"audio",
	"prediction",
	"metadata",
	"store",
	"prompt_cache_key",
	"safety_identifier",
	"verbosity",
	"web_search_options",
] as const;

/** OpenAI 兼容 Provider 基类实现 */
export class OpenAICompatProvider implements ProviderConfig {
	protected apiKey: string;
	protected apiBase: string;

	constructor(apiKey: string, apiBase: string) {
		this.apiKey = apiKey;
		this.apiBase = this._normalizeApiBase(apiBase);
	}

	/**
	 * 将标准请求转换为该 Provider 的请求格式
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	transformRequest(
		model: string,
		messages: {
			role: string;
			content: string | null;
		}[],
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const body: Record<string, unknown> = {
			model: this.stripProviderPrefix(model),
			messages: messages,
		};

		const stream = optionalParams.stream === true;
		if (stream) {
			body.stream = true;
		}

		// 透传支持的参数
		for (const key of SUPPORTED_PARAMS) {
			if (key === "stream") {
				continue;
			}
			if (key in optionalParams) {
				body[key] = optionalParams[key];
			}
		}

		// Python LiteLLM 行为：optionalParams.api_base 优先于构造函数 apiBase
		const apiBaseRaw = optionalParams["api_base"];
		const apiBase = typeof apiBaseRaw === "string" && apiBaseRaw.length > 0 ? apiBaseRaw : this.apiBase;
		// 同步应用尾部斜杠 / 已知 operation path 归一化
		const normalizedBase = this._normalizeApiBase(apiBase);

		// api_key 同理：deployment key 优先
		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this.apiKey;

		return {
			url: `${normalizedBase}/chat/completions`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: body,
			model: model,
			stream: stream,
		};
	}

	/**
	 * 构造 OpenAI-compatible embeddings 请求。
	 * 只透传正式 embeddings 参数，连接参数仅用于 URL 与 Header。
	 * @param model - 模型名称
	 * @param input - 原始 embeddings 输入
	 * @param optionalParams - deployment 与请求参数
	 */
	transformEmbeddingRequest(model: string, input: unknown, optionalParams: Record<string, unknown>): ProviderRequest {
		const body: Record<string, unknown> = {
			model: this.stripProviderPrefix(model),
			input: input,
		};
		for (const key of EMBEDDING_SUPPORTED_PARAMS) {
			if (key in optionalParams) {
				body[key] = optionalParams[key];
			}
		}

		const apiBaseRaw = optionalParams["api_base"];
		const apiBase = typeof apiBaseRaw === "string" && apiBaseRaw.length > 0 ? apiBaseRaw : this.apiBase;
		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this.apiKey;

		return {
			url: `${this._normalizeApiBase(apiBase)}/embeddings`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: body,
			model: model,
			stream: false,
		};
	}

	/**
	 * 将 Provider 原始响应转换为标准 ModelResponse
	 * @param model
	 * @param rawResponse
	 * @param usage
	 */
	transformResponse(
		model: string,
		rawResponse: unknown,
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
		},
	): ModelResponse {
		const raw = rawResponse as Record<string, unknown>;

		// PY convert_dict_to_response.py:191-195：上游 id truthy 时透传，falsy（缺省/""/null）
		// 时保留 ModelResponse 预生成的 "chatcmpl-<uuid>"
		const upstreamId = raw.id;
		const responseId = typeof upstreamId === "string" && upstreamId.length > 0 ? upstreamId : generateChatCompletionId();
		const rawUsage = (raw.usage as Record<string, unknown> | undefined) ?? {};
		const promptTokenDetails = rawUsage["prompt_tokens_details"];
		const completionTokenDetails = rawUsage["completion_tokens_details"];

		return {
			id: responseId,
			object: (raw.object as string) ?? "chat.completion",
			created: (raw.created as number) ?? Math.floor(Date.now() / 1000),
			model: model,
			choices: ((raw.choices as unknown[]) ?? []).map((choice: unknown) => {
				const c = choice as Record<string, unknown>;
				const msg = c.message as Record<string, unknown> | undefined;
				return {
					index: (c.index as number) ?? 0,
					finish_reason: (c.finish_reason as string) ?? "stop",
					message: {
						role: (msg?.role as string) ?? "assistant",
						content: (msg?.content as string | null) ?? null,
						tool_calls: msg?.tool_calls as ToolCall[] | undefined,
						reasoning_content: msg?.reasoning_content as string | undefined,
						thinking_blocks: msg?.thinking_blocks as ModelResponse["choices"][number]["message"]["thinking_blocks"],
						provider_specific_fields: msg?.provider_specific_fields as Record<string, unknown> | undefined,
					},
				};
			}),
			usage: {
				prompt_tokens: _extractNumber(usage?.prompt_tokens, raw.usage, "prompt_tokens"),
				completion_tokens: _extractNumber(usage?.completion_tokens, raw.usage, "completion_tokens"),
				total_tokens: _extractNumber(usage?.total_tokens, raw.usage, "total_tokens"),
				...(typeof promptTokenDetails === "object" && promptTokenDetails !== null
					? { prompt_tokens_details: promptTokenDetails }
					: {}),
				...(typeof completionTokenDetails === "object" && completionTokenDetails !== null
					? { completion_tokens_details: completionTokenDetails }
					: {}),
				...(typeof rawUsage["cache_creation_input_tokens"] === "number"
					? { cache_creation_input_tokens: rawUsage["cache_creation_input_tokens"] }
					: {}),
				...(typeof rawUsage["cache_read_input_tokens"] === "number"
					? { cache_read_input_tokens: rawUsage["cache_read_input_tokens"] }
					: {}),
			},
		};
	}

	/**
	 * 获取该 Provider 支持的请求参数列表
	 */
	getSupportedParams(): string[] {
		return [...SUPPORTED_PARAMS];
	}

	/**
	 * 是否支持流式响应
	 */
	supportsStreaming(): boolean {
		return true;
	}

	/**
	 * 解析 SSE 流响应，生成 ModelResponseStream 块
	 *
	 * 处理标准 SSE 格式：
	 *   data: {"json": "payload"}\n
	 *   data: [DONE]\n
	 * @param response
	 * @yields {ModelResponseStream}
	 */
	async *streamResponse(response: Response): AsyncGenerator<ModelResponseStream> {
		const reader = response.body?.getReader();
		if (!reader) {
			return;
		}

		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					buffer += decoder.decode();
					const residual = buffer.trim();
					if (!residual.startsWith("data: ")) {
						break;
					}
					const payload = residual.slice(6);
					if (payload === "[DONE]") {
						return;
					}
					let parsed: ModelResponseStream;
					try {
						parsed = JSON.parse(payload) as ModelResponseStream;
					} catch {
						throw new Error("Provider 返回 malformed SSE event");
					}
					if (!parsed.id) {
						parsed.id = generateChatCompletionId();
					}
					yield parsed;
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				// 保留最后一个不完整的行到下次迭代
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data: ")) {
						continue;
					}

					const payload = trimmed.slice(6);
					if (payload === "[DONE]") {
						return;
					}

					let parsed: ModelResponseStream;
					try {
						parsed = JSON.parse(payload) as ModelResponseStream;
					} catch {
						throw new Error("Provider 返回 malformed SSE event");
					}
					// PY ModelResponseStream(**chunk)：chunk 缺 id 时按 "chatcmpl-<uuid>" 重新生成
					if (!parsed.id) {
						parsed.id = generateChatCompletionId();
					}
					yield parsed;
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * 将 API base 归一化为不含 operation path 的形式。
	 * @param apiBase
	 */
	private _normalizeApiBase(apiBase: string): string {
		return apiBase.replace(/\/+$/, "").replace(/\/(?:chat\/completions|embeddings)$/, "");
	}

	/**
	 * 去除模型名中的 Provider 前缀（如 "deepseek/deepseek-chat" → "deepseek-chat"）
	 * @param model
	 */
	stripProviderPrefix(model: string): string {
		const slashIndex = model.indexOf("/");
		if (slashIndex !== -1) {
			return model.slice(slashIndex + 1);
		}
		return model;
	}
}

/**
 * 从多个来源安全提取数值
 * @param first
 * @param second
 * @param key
 */
function _extractNumber(first: unknown, second: unknown, key: string): number {
	if (typeof first === "number") {
		return first;
	}
	if (second !== null && typeof second === "object") {
		const v = (second as Record<string, unknown>)[key];
		if (typeof v === "number") {
			return v;
		}
	}
	return 0;
}
