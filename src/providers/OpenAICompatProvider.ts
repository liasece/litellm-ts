/**
 * OpenAI 兼容 Provider 基类
 *
 * 作为 DeepSeek、vLLM、MiMo 等 OpenAI 兼容 API 的基类。
 * 处理标准 OpenAI 格式的请求/响应转换、SSE 流解析。
 */

import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { ModelResponse, ModelResponseStream, ToolCall } from "../types/openai";

/** 默认支持的 OpenAI 参数列表 */
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
] as const;

/** OpenAI 兼容 Provider 基类实现 */
export class OpenAICompatProvider implements ProviderConfig {
	protected apiKey: string;
	protected apiBase: string;

	constructor(apiKey: string, apiBase: string) {
		this.apiKey = apiKey;
		this.apiBase = apiBase.replace(/\/$/, "").replace(/\/chat\/completions$/, "");
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

		return {
			url: `${this.apiBase}/chat/completions`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: body,
			model: model,
			stream: stream,
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

		return {
			id: (raw.id as string) ?? "",
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
					},
				};
			}),
			usage: {
				prompt_tokens: _extractNumber(usage?.prompt_tokens, raw.usage, "prompt_tokens"),
				completion_tokens: _extractNumber(usage?.completion_tokens, raw.usage, "completion_tokens"),
				total_tokens: _extractNumber(usage?.total_tokens, raw.usage, "total_tokens"),
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

					try {
						const parsed = JSON.parse(payload) as ModelResponseStream;
						yield parsed;
					} catch {
						// 忽略无法解析的行
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
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
