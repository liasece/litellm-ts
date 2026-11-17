/**
 * Google AI Studio Gemini Provider
 *
 * 走 native generateContent / streamGenerateContent 协议，而不是 OpenAI 兼容端点：
 * Gemini 4 Hydrogen 的思考等级（thinkingLevel）与工具调用 thoughtSignature 只在
 * native 协议里完整可用，OpenAI 兼容层没有对应字段。请求与响应复用订阅运行时
 * `protocol/convert` 的规范化编解码，避免再维护一套 OpenAI ↔ Gemini 映射。
 *
 * 计费注意：Gemini 把思考 token 计入输出并收费，而本仓库 CostCalculator 会从
 * completion_tokens 中扣除 reasoning_tokens（PY 默认把 reasoning 单价视为 0）。
 * 因此这里保留 completion_tokens 含思考 token 的总量、去掉 reasoning_tokens 明细，
 * 避免 Gemini 思考部分被漏计费。见 `stripReasoningTokenDetail`。
 */

import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { ModelResponse, ModelResponseStream, Usage } from "../types/openai";
import { createStreamTranslator, translateRequest, translateResponse } from "../subscriptions/native/protocol/types";
import type { ProtocolEvent } from "../subscriptions/native/protocol/types";
import { DUMMY_THOUGHT_SIGNATURE, asRecord } from "../subscriptions/native/protocol/convert/shared";

/** AI Studio 默认 base；与 litellm Python `gemini/` 路由一致。 */
const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * 可以由 Chat Completions 入参映射到 Gemini 的参数。
 *
 * 连接与路由字段（api_key、api_base、custom_llm_provider、timeout 等）不在这里，
 * 它们只影响请求封装，不能进入上游 body。
 */
const SUPPORTED_PARAMS = [
	"temperature",
	"top_p",
	"top_k",
	"max_tokens",
	"max_completion_tokens",
	"stop",
	"n",
	"seed",
	"presence_penalty",
	"frequency_penalty",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"response_format",
	"reasoning_effort",
	"thinking",
] as const;

/** Gemini 3 起用 thinkingLevel 取代 thinkingBudget。 */
const THINKING_LEVEL_MODEL = /^gemini-(?:3|4)(?:[.-]|$)/i;

/** Gemini 4 Hydrogen 是当前唯一接受 xhigh 的 Gemini 4 模型。 */
const XHIGH_MODEL = /gemini-4-hydrogen(?:[.-]|$)/i;

/**
 * 把部署模型名转成 Gemini 上游模型 ID。
 * @param model - 例如 gemini/gemini-4-hydrogen
 */
function upstreamModelOf(model: string): string {
	const slash = model.indexOf("/");
	const base = slash === -1 ? model : model.slice(slash + 1);
	return base.replace(/^models\//, "");
}

/**
 * 判断模型是否使用 thinkingLevel。
 * @param model - 上游模型 ID
 */
function usesThinkingLevel(model: string): boolean {
	return THINKING_LEVEL_MODEL.test(upstreamModelOf(model));
}

/**
 * 从请求参数读取调用方要求的思考等级。
 *
 * OpenAI 客户端主要传 reasoning_effort；Anthropic 风格客户端传 thinking。
 * 两者都没有时返回 undefined，让 Gemini 使用自己的默认等级（Hydrogen 为 high）。
 * @param params - 请求可选参数
 */
function requestedThinking(params: Record<string, unknown>): { level: string; includeThoughts: boolean } | undefined {
	const rawEffort = params["reasoning_effort"];
	const effort =
		typeof rawEffort === "string"
			? rawEffort
			: typeof rawEffort === "object" && rawEffort !== null
				? (rawEffort as Record<string, unknown>)["effort"]
				: undefined;
	if (typeof effort === "string") {
		return { level: effort.toLowerCase(), includeThoughts: true };
	}
	const thinking = asRecord(params["thinking"]);
	if (thinking === undefined) {
		return undefined;
	}
	if (thinking["type"] === "disabled") {
		return { level: "low", includeThoughts: false };
	}
	const budget = thinking["budget_tokens"];
	if (typeof budget === "number") {
		const level = budget <= 0 ? "low" : budget <= 4_096 ? "low" : budget <= 16_384 ? "medium" : budget <= 32_768 ? "high" : "xhigh";
		return { level: level, includeThoughts: budget > 0 };
	}
	return undefined;
}

/**
 * 把 OpenAI 的思考档位映射到 Gemini thinkingLevel。
 *
 * Hydrogen 拒绝 minimal；4 Argon/Carbon 与 Gemini 3 没有 xhigh。无法映射的档位
 * 保持原样交给上游，让 400 暴露真实参数错误，而不是静默改成别的等级。
 * @param level - 调用方档位
 * @param model - 上游模型 ID
 */
function mapThinkingLevel(level: string, model: string): string | undefined {
	switch (level) {
		case "low":
		case "medium":
		case "high":
			return level;
		case "xhigh":
			return XHIGH_MODEL.test(model) ? "xhigh" : "high";
		case "minimal":
			// Gemini 3 Flash 支持 minimal；Hydrogen 明确拒绝，回退到 low。
			return /^gemini-3(?:[.-][0-9]+)*-flash/.test(model) ? "minimal" : "low";
		case "disable":
		case "none":
			return "low";
		default:
			return undefined;
	}
}

/**
 * 把规范化编码得到的 thinkingBudget 改写成 thinkingLevel。
 * @param body - Gemini 请求体（会被就地修改）
 * @param model - 上游模型 ID
 * @param params - 原始请求参数
 */
function applyThinkingLevel(body: Record<string, unknown>, model: string, params: Record<string, unknown>): void {
	if (!usesThinkingLevel(model)) {
		return;
	}
	const requested = requestedThinking(params);
	if (requested === undefined) {
		return;
	}
	const level = mapThinkingLevel(requested.level, model);
	if (level === undefined) {
		return;
	}
	const generationConfig = asRecord(body["generationConfig"]) ?? {};
	const existing = asRecord(generationConfig["thinkingConfig"]);
	generationConfig["thinkingConfig"] = {
		thinkingLevel: level,
		includeThoughts: requested.includeThoughts,
		// 保留调用方可能显式给出的其它 thinkingConfig 字段（如 future 扩展），但
		// thinkingBudget 与 thinkingLevel 不能并存，必须丢弃。
		...Object.fromEntries(
			Object.entries(existing ?? {}).filter(
				([key]) => key !== "thinkingBudget" && key !== "thinkingLevel" && key !== "includeThoughts",
			),
		),
	};
	body["generationConfig"] = generationConfig;
}

/**
 * Gemini 3+ 要求历史 functionCall 携带 thoughtSignature。
 *
 * 客户端回传的调用 ID 通常带签名；若历史来自旧会话或客户端丢弃了 ID 后缀，
 * 用官方占位签名通过严格校验，避免整轮工具调用 400（真实签名仍优先）。
 * @param body - Gemini 请求体（会被就地修改）
 * @param model - 上游模型 ID
 */
function applyThoughtSignatureFallback(body: Record<string, unknown>, model: string): void {
	if (!usesThinkingLevel(model)) {
		return;
	}
	const contents = body["contents"];
	if (!Array.isArray(contents)) {
		return;
	}
	for (const content of contents) {
		const record = asRecord(content);
		if (record?.["role"] !== "model") {
			continue;
		}
		const parts = record["parts"];
		if (!Array.isArray(parts)) {
			continue;
		}
		for (const rawPart of parts) {
			const part = asRecord(rawPart);
			if (part === undefined || asRecord(part["functionCall"]) === undefined) {
				continue;
			}
			if (typeof part["thoughtSignature"] !== "string" || part["thoughtSignature"].length === 0) {
				part["thoughtSignature"] = DUMMY_THOUGHT_SIGNATURE;
			}
		}
	}
}

/**
 * 去掉 reasoning_tokens 明细，保留含思考 token 的 completion_tokens。
 * @param usage - 响应或流式帧上的用量
 */
function stripReasoningTokenDetail(usage: Usage | null | undefined): void {
	if (!usage) {
		return;
	}
	const details = usage.completion_tokens_details;
	if (!details) {
		return;
	}
	if (typeof details.reasoning_tokens === "number") {
		delete details.reasoning_tokens;
	}
	if (Object.keys(details).length === 0) {
		delete usage.completion_tokens_details;
	}
}

/**
 * 读取 SSE 数据行中的 JSON；非 JSON 行返回 undefined。
 * @param payload - `data:` 后的文本
 */
function parsePayload(payload: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(payload);
		return asRecord(parsed);
	} catch {
		return undefined;
	}
}

/** Google AI Studio Gemini Provider。 */
export class GeminiProvider implements ProviderConfig {
	private readonly _apiKey: string;
	private readonly _apiBase: string;

	constructor(apiKey = "", apiBase = DEFAULT_API_BASE) {
		this._apiKey = apiKey;
		this._apiBase = apiBase.replace(/\/+$/, "");
	}

	/**
	 * 构造 Gemini generateContent / streamGenerateContent 请求。
	 * @param model - 部署模型名（可能带 gemini/ 前缀）
	 * @param messages - OpenAI Chat 消息
	 * @param optionalParams - 请求参数与 deployment 连接参数
	 */
	transformRequest(
		model: string,
		messages: { role: string; content: string | null }[],
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const stream = optionalParams["stream"] === true;
		const upstreamModel = upstreamModelOf(model);

		const chatBody: Record<string, unknown> = {
			messages: messages as unknown as Record<string, unknown>[],
			...(stream ? { stream: true } : {}),
		};
		for (const key of SUPPORTED_PARAMS) {
			if (optionalParams[key] !== undefined) {
				chatBody[key] = optionalParams[key];
			}
		}

		const body = translateRequest("chat", "gemini", chatBody, {
			model: model,
			upstreamModel: upstreamModel,
		});
		// Gemini REST 的模型在 URL 路径上；body 里没有 model 字段，多余字段会被判 400。
		delete body["model"];
		applyThinkingLevel(body, upstreamModel, optionalParams);
		applyThoughtSignatureFallback(body, upstreamModel);

		const apiKeyRaw = optionalParams["api_key"];
		const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : this._apiKey;
		const apiBaseRaw = optionalParams["api_base"];
		const apiBase = typeof apiBaseRaw === "string" && apiBaseRaw.length > 0 ? apiBaseRaw.replace(/\/+$/, "") : this._apiBase;

		return {
			url: `${apiBase}/models/${upstreamModel}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// 用 header 而不是 ?key=，避免密钥进入 URL、日志和上游 request 记录。
				"x-goog-api-key": apiKey,
				...(stream ? { Accept: "text/event-stream" } : {}),
			},
			body: body,
			model: model,
			stream: stream,
		};
	}

	/**
	 * 把 Gemini 响应翻译成标准 ModelResponse。
	 * @param model - 部署模型名
	 * @param rawResponse - Gemini 响应体
	 */
	transformResponse(model: string, rawResponse: unknown): ModelResponse {
		const response = translateResponse("chat", "gemini", asRecord(rawResponse) ?? {}, {
			model: model,
			upstreamModel: upstreamModelOf(model),
		}) as unknown as ModelResponse;
		stripReasoningTokenDetail(response.usage);
		return response;
	}

	/**
	 * 支持的核心参数。
	 */
	getSupportedParams(): string[] {
		return [...SUPPORTED_PARAMS];
	}

	/**
	 * Gemini 原生支持 SSE 流式。
	 */
	supportsStreaming(): boolean {
		return true;
	}

	/**
	 * 把 Gemini SSE 帧翻译成 Chat Completions chunk。
	 *
	 * 流式响应的 model 不在入参里：用每帧的 modelVersion 更新翻译器的输出模型，
	 * 再由端点按本次请求的模型名覆盖（fallback 时也一致）。
	 * @param response - 上游 SSE 响应
	 * @yields Chat Completions 流式 chunk
	 */
	async *streamResponse(response: Response): AsyncGenerator<ModelResponseStream> {
		const reader = response.body?.getReader();
		if (!reader) {
			return;
		}
		const decoder = new TextDecoder();
		let buffer = "";
		const options = { model: "", upstreamModel: "" };
		const translator = createStreamTranslator("chat", "gemini", options);

		const emit = (events: ProtocolEvent[]): ModelResponseStream[] => {
			const chunks: ModelResponseStream[] = [];
			for (const event of events) {
				if (typeof event.data === "string") {
					continue;
				}
				const chunk = event.data as unknown as ModelResponseStream;
				// 错误事件没有 id，但仍要交给端点抛出；其余帧必须有 id 才能被客户端识别。
				if (!("error" in chunk) && !chunk.id) {
					continue;
				}
				stripReasoningTokenDetail(chunk.usage ?? chunk._usage);
				chunks.push(chunk);
			}
			return chunks;
		};

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					buffer += decoder.decode();
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) {
						continue;
					}
					const payload = parsePayload(trimmed.slice(5).trim());
					if (payload === undefined) {
						continue;
					}
					if (typeof payload["modelVersion"] === "string" && payload["modelVersion"].length > 0) {
						options.model = payload["modelVersion"];
						options.upstreamModel = payload["modelVersion"];
					}
					for (const chunk of emit(translator.push({ data: payload }))) {
						yield chunk;
					}
				}
			}
			for (const chunk of emit(translator.flush())) {
				yield chunk;
			}
		} finally {
			reader.releaseLock();
		}
	}
}
