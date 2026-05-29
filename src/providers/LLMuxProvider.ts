/**
 * LLMux Provider (Subscription Proxy)
 *
 * Routes Anthropic models to /v1/messages (Anthropic endpoint),
 * OpenAI models to /v1/chat/completions (OpenAI endpoint) on llmux.
 *
 * This is a pure proxy -- it forwards requests as-is with the right auth header.
 * It does NOT translate protocols; llmux handles that itself.
 *
 * Default api_base: http://192.168.1.220:18182
 * Uses llmux-specific API key for authentication.
 */
import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { Message, ModelResponse, ModelResponseStream, ToolCall } from "../types/openai";

/**
 * 模型协议类型
 */
type Protocol = "anthropic" | "openai";

/** Anthropic 模型名称前缀列表 */
const ANTHROPIC_MODEL_PREFIXES = ["claude", "anthropic"];

/**
 * 判断模型使用 Anthropic 协议
 * @param model
 */
function detectProtocol(model: string): Protocol {
	const lower = model.toLowerCase();
	if (ANTHROPIC_MODEL_PREFIXES.some((p) => lower.startsWith(p))) {
		return "anthropic";
	}
	return "openai";
}

/**
 * LLMux 提供商（订阅代理）
 *
 * 将 Anthropic 模型路由到 /v1/messages，OpenAI 模型路由到 /v1/chat/completions，
 * 透传请求不做协议转换。
 */
export class LLMuxProvider implements ProviderConfig {
	private _apiBase: string;

	constructor(apiBase = "http://192.168.1.220:18182") {
		this._apiBase = apiBase.replace(/\/$/, "");
	}

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const protocol = detectProtocol(model);
		const apiKey = (optionalParams.api_key as string) ?? "";

		// 构建消息体，透传所有参数
		const body: Record<string, unknown> = {
			model: model,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
				...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
				...((m as unknown as Record<string, unknown>).tool_call_id
					? { tool_call_id: (m as unknown as Record<string, unknown>).tool_call_id }
					: {}),
			})),
			max_tokens: (optionalParams.max_tokens as number) ?? 4096,
		};

		if (optionalParams.temperature !== undefined) {
			body.temperature = optionalParams.temperature;
		}
		if (optionalParams.top_p !== undefined) {
			body.top_p = optionalParams.top_p;
		}
		if (optionalParams.stream === true) {
			body.stream = true;
		}
		if (optionalParams.tools) {
			body.tools = optionalParams.tools;
		}
		if (optionalParams.system) {
			body.system = optionalParams.system;
		}

		const endpointPath = protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
		};

		return {
			url: `${this._apiBase}${endpointPath}`,
			method: "POST",
			headers: headers,
			body: body,
			model: model,
			stream: optionalParams.stream as boolean | undefined,
		};
	}

	/**
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
		const id = (raw.id as string) ?? `llmux-${Date.now()}`;
		const respModel = (raw.model as string) ?? model;

		// 从原始响应提取 usage
		const rawUsage = raw.usage as Record<string, unknown> | undefined;
		const resolvedUsage = usage ?? {
			prompt_tokens:
				(typeof rawUsage?.prompt_tokens === "number" ? rawUsage.prompt_tokens : undefined) ??
				(typeof rawUsage?.input_tokens === "number" ? rawUsage.input_tokens : 0),
			completion_tokens:
				(typeof rawUsage?.completion_tokens === "number" ? rawUsage.completion_tokens : undefined) ??
				(typeof rawUsage?.output_tokens === "number" ? rawUsage.output_tokens : 0),
			total_tokens:
				(typeof rawUsage?.total_tokens === "number" ? rawUsage.total_tokens : undefined) ??
				(typeof rawUsage?.input_tokens === "number" && typeof rawUsage?.output_tokens === "number"
					? rawUsage.input_tokens + rawUsage.output_tokens
					: 0),
		};

		return {
			id: id,
			created: Math.floor(Date.now() / 1000),
			model: respModel,
			object: "chat.completion",
			choices: this.extractChoices(raw),
			usage: {
				prompt_tokens: resolvedUsage.prompt_tokens ?? 0,
				completion_tokens: resolvedUsage.completion_tokens ?? 0,
				total_tokens: resolvedUsage.total_tokens ?? 0,
			},
		};
	}

	/**
	 * 获取 LLMux 支持的所有请求参数列表
	 */
	getSupportedParams(): string[] {
		return ["max_tokens", "temperature", "top_p", "stream", "tools", "api_key", "system"];
	}

	/**
	 * 是否支持流式响应
	 */
	supportsStreaming(): boolean {
		return true;
	}

	/**
	 * 解析 SSE 流响应，生成 ModelResponseStream 块
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
						// ignore unparseable lines
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * 从响应中提取 choices
	 * @param raw
	 */
	extractChoices(raw: Record<string, unknown>): Array<{
		finish_reason: string;

		index: number;

		message: {
			role: string;
			content: string | null;
			tool_calls?: ToolCall[] | undefined;
		};
	}> {
		const rawChoices = (raw.choices as unknown[]) ?? [];
		if (rawChoices.length > 0) {
			return rawChoices.map((c) => {
				const choice = c as Record<string, unknown>;
				const msg = (choice.message ?? choice.delta) as Record<string, unknown> | undefined;
				return {
					index: (choice.index as number) ?? 0,
					finish_reason: (choice.finish_reason as string) ?? "stop",
					message: {
						role: (msg?.role as string) ?? "assistant",
						content: (msg?.content as string | null) ?? null,
						tool_calls: msg?.tool_calls as ToolCall[] | undefined,
					},
				};
			});
		}

		// Anthropic 风格的响应（没有 choices，直接有 content/stop_reason）
		const rawContent = raw.content;
		let content: string | null = null;
		if (typeof rawContent === "string") {
			content = rawContent;
		} else if (Array.isArray(rawContent)) {
			// 从 Anthropic 内容块数组中提取文本
			content =
				rawContent
					.filter((b: unknown) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text")
					.map((b: unknown) => ((b as Record<string, unknown>).text as string) ?? "")
					.join("") || null;
		}
		const stopReason = (raw.stop_reason as string) ?? "end_turn";
		const stopReasonMap: Record<string, string> = { end_turn: "stop", tool_use: "tool_calls", max_tokens: "length" };
		return [
			{
				index: 0,
				finish_reason: stopReasonMap[stopReason] ?? stopReason,
				message: {
					role: "assistant",
					content: content,
				},
			},
		];
	}
}
