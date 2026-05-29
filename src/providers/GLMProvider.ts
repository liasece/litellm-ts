/**
 * GLM Provider (Zhipu BigModel / Z.AI)
 *
 * 对齐 PY litellm/llms/zai/chat/transformation.py — ZAIChatConfig extends OpenAIGPTConfig
 * 走标准 OpenAI 格式协议：POST /chat/completions，支持 max_tokens / stream / tools / tool_choice /
 * stop / temperature / top_p。Supports thinking via litellm.supports_reasoning。
 *
 * DIFF-CFG-ZAI-01: 默认 api_base 改为 https://api.z.ai/api/paas/v4（对齐 PY ZAIChatConfig）
 * 如需兼容 bigmodel.cn，请通过环境变量 GLM_API_BASE 或显式 constructor 参数覆盖。
 *
 * Supports GLM-5.1, GLM-5-Turbo, glm-4.7 and chatglm series.
 */
import type { ProviderRequest } from "../types/provider";
import type { Message } from "../types/openai";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/**
 * GLM 提供商（智谱 BigModel / Z.AI）
 *
 * 对齐 Python ZAIChatConfig：基于 OpenAIGPTConfig 复用 OpenAI 协议。
 * 保留 cache_control 透传（PY 显式不剥离），暴露 thinking 支持（通过 litellm.supports_reasoning）。
 */
export class GLMProvider extends OpenAICompatProvider {
	constructor(
		apiKey = "",
		apiBase: string = (typeof process !== "undefined" ? process.env?.GLM_API_BASE : undefined) ?? "https://api.z.ai/api/paas/v4",
	) {
		super(apiKey, apiBase);
	}

	/**
	 * DIFF-OPENAI-COMPAT-01: GLM 仅支持 9 个核心参数 + thinking。
	 * 对齐 PY ZAIChatConfig.get_supported_openai_params (transformation.py:36-58)：
	 *   max_tokens, stream, stream_options, temperature, top_p, stop, tools, tool_choice, [thinking]
	 *
	 * 与 OpenAICompatProvider 默认 22 个参数不同；transformRequest 内部按此白名单过滤。
	 */
	override getSupportedParams(): string[] {
		return ["max_tokens", "stream", "stream_options", "temperature", "top_p", "stop", "tools", "tool_choice", "thinking"];
	}

	/**
	 * OpenAI 风格请求转换（对齐 PY ZAIChatConfig）
	 *
	 * DIFF-OPENAI-COMPAT-01: 透传前过滤未声明字段，避免 unsupported params 透传到 GLM 端点。
	 *
	 * DIFF-009: 移除 stripModelPrefix 调用 — 对齐 PY ZAIChatConfig 不修改 model name 的行为。
	 *   PY litellm/llms/zai/chat/transformation.py 中 ZAIChatConfig 没有任何 model name mutation,
	 *   上游 z.ai API 直接接收完整 `glm-4.6` / `chatglm-3` 等前缀。之前 TS 端剥离 prefix
	 *   会让上游收到 `4.6` 等无效模型名。
	 *
	 * DIFF-GLM-01: cache_control 透传 — 对齐 PY ZAIChatConfig 不剥离 cache_control 的行为。
	 * 当前 OpenAICompatProvider 父类未实现 cache_control 剥离，cache_control 自然透传。
	 * 未来父类若改为剥离，需在父类显式 override 保留。
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		// DIFF-009: 不再剥离 glm- / chatglm- 前缀 — PY ZAIChatConfig 不做任何 model name mutation。
		// 之前 TS 端 stripModelPrefix(model) 会让上游 z.ai API 收到 "4.6" 等无效模型名。
		const upstreamModel = model;
		// 合并 apiKey：deployment 上 litellm_params.api_key 优先
		const apiKey = (optionalParams["api_key"] as string | undefined) ?? this.apiKey;
		// DIFF-OPENAI-COMPAT-01: 过滤未声明字段（仅保留 getSupportedParams 返回列表）
		const allowed = new Set(this.getSupportedParams());
		const filtered: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(optionalParams)) {
			if (k === "stream" || k === "api_key" || allowed.has(k)) {
				filtered[k] = v;
			}
		}
		// 临时把 apiKey 写到 this.apiKey（OpenAICompatProvider base 读 this.apiKey 写 Authorization header）
		const prevApiKey = this.apiKey;
		if (apiKey) {
			this.apiKey = apiKey;
		}
		try {
			return super.transformRequest(upstreamModel, messages, filtered);
		} finally {
			this.apiKey = prevApiKey;
		}
	}
}
