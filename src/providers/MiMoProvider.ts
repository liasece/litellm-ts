/**
 * MiMo Provider (Xiaomi) - 中国 region（Anthropic 兼容协议）
 *
 * 对齐 PY：MiMo 在 Python 仓库无独立 provider 文件，回退到 OpenAI 兼容路径
 * （litellm/llms/openai_like/providers.json 仅在 tokenization 提及 mimo）。
 *
 * TS 实际部署的 MiMo 中国 region 端点使用 Anthropic 兼容协议（与 GLM 同源），所以采用
 * **AnthropicProvider 组合**的方式复用其所有 beta 头、output_config 校验、
 * thinking 块、response_format 原生输出、tools/allowed_callers、files-api、
 * code-execution、compact-2026、oauth-2025、fast-mode、effort beta、structured-outputs、
 * web-fetch、context-management、tool-search、mcp-client、computer-use 注入。
 *
 * Default api_base: https://token-plan-cn.xiaomimimo.com
 * Supports mimo-v2.5-pro, mimo-v2.5
 *
 * 国际 region 端点请使用 MiMoOpenAIProvider（OpenAI 兼容协议）。
 */
import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { Message, ModelResponse, ModelResponseStream } from "../types/openai";
import { AnthropicProvider } from "./AnthropicProvider";

/**
 * MiMo 提供商（小米）- 中国 region
 *
 * 通过组合 AnthropicProvider 复用其全部 Anthropic 协议能力（betas、output_config、
 * thinking、response_format 等），并允许 override api_base 指向 MiMo 端点。
 *
 * DIFF-MIMO-INTERFACE-01: 恢复 `implements ProviderConfig` 约束，确保 transformRequest /
 * transformResponse / getSupportedParams / supportsStreaming / streamResponse 签名
 * 与 OpenAI 兼容 provider 家族完全一致（之前用 `class MiMoProvider` 隐式独立类型，
 * 导致 ProviderRegistry.getProvider() 返回值缺少显式契约）。
 */
export class MiMoProvider implements ProviderConfig {
	private _anthropic: AnthropicProvider;

	constructor(apiBase = "https://token-plan-cn.xiaomimimo.com") {
		this._anthropic = new AnthropicProvider(apiBase);
	}

	/**
	 * 委托给 AnthropicProvider.transformRequest
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		// DIFF-MIMO-NORM-01: 消息归一化 — MiMo 端点对 tool_use id 格式要求严格，
		// 上游 Anthropic 风格 tool_use id 可能带前缀（如 toolu_），MiMo 端点需要 strip 前缀。
		// 该归一化是本地经验（未对齐 Python litellm 任何已知 commit），仅作为兼容性兜底。
		// 若未来需要证据来源，应附实际 PR/issue 引用。
		const normalizedMessages = this._stripToolUseIdPrefix(messages);
		return this._anthropic.transformRequest(model, normalizedMessages, optionalParams);
	}

	/**
	 * 归一化 assistant 消息内 tool_use id：去除 `toolu_` 前缀（MiMo 端点要求纯 id）。
	 * 此为本地经验补丁；之前引用 `litellm commit b2e1c8cb78` 实际上并不处理此场景，
	 * 注释已修正为本地实现。
	 * @param messages
	 */
	private _stripToolUseIdPrefix(messages: Message[]): Message[] {
		return messages.map((m) => {
			if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) {
				return m;
			}
			const toolCalls = m.tool_calls.map((tc) => ({
				...tc,
				id: tc.id.startsWith("toolu_") ? tc.id.slice(6) : tc.id,
			}));
			return { ...m, tool_calls: toolCalls };
		});
	}

	/**
	 * 委托给 AnthropicProvider.transformResponse
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
		// AnthropicProvider.transformResponse 要求 usage 字段非 optional；缺省时传 undefined
		return this._anthropic.transformResponse(
			model,
			rawResponse,
			usage
				? {
						prompt_tokens: usage.prompt_tokens ?? 0,
						completion_tokens: usage.completion_tokens ?? 0,
						total_tokens: usage.total_tokens ?? 0,
					}
				: undefined,
		);
	}

	/**
	 * 委托给 AnthropicProvider.getSupportedParams
	 */
	getSupportedParams(): string[] {
		return this._anthropic.getSupportedParams();
	}

	/**
	 * 委托给 AnthropicProvider.supportsStreaming
	 */
	supportsStreaming(): boolean {
		return this._anthropic.supportsStreaming();
	}

	/**
	 * 委托给 AnthropicProvider.streamResponse
	 * @param response
	 */
	streamResponse(response: Response): AsyncGenerator<ModelResponseStream> {
		return this._anthropic.streamResponse(response);
	}

	/**
	 * 委托给 AnthropicProvider.getCacheControlHeaders
	 */
	getCacheControlHeaders(): Record<string, string> {
		return this._anthropic.getCacheControlHeaders();
	}
}
