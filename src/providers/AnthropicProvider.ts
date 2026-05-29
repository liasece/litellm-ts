/**
 * Anthropic Provider
 *
 * Anthropic Messages API implementation. 实现 OpenAI -> Anthropic 双向格式转换。
 * Default api_base: https://api.anthropic.com
 *
 * Python ref: litellm/llms/anthropic/chat/transformation.py
 */
import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { Message, ModelResponse, ModelResponseStream, TokenDetails, PromptTokenDetails, Usage } from "../types/openai";
import type { AnthropicContentBlock, AnthropicSSEEvent } from "../types/anthropic";
import { cleanSurrogates } from "../core/utils/text";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ANTHROPIC_CHAT_MAX_TOKENS = 4096;
const RESPONSE_FORMAT_TOOL_NAME = "json_tool_call";
const DEFAULT_REASONING_EFFORT_LOW_THINKING_BUDGET = 1024;
const DEFAULT_REASONING_EFFORT_MEDIUM_THINKING_BUDGET = 2048;
const DEFAULT_REASONING_EFFORT_HIGH_THINKING_BUDGET = 4096;
const DEFAULT_REASONING_EFFORT_MINIMAL_THINKING_BUDGET = 128;

type StreamInternal = ModelResponseStream & {
	_toolUseIndexOffset?: number;
	_isFinal?: boolean;
	usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

interface StreamState {
	responseId: string;
	responseModel: string;
	created: number;
	toolUseIndexOffset: number;
	jsonFragments: Record<number, string>;
	stopReason: string | null;
	_accumulatedJson?: string;
	// PY: streaming accumulators (handler.py)
	jsonMode: boolean;
	isResponseFormatTool: boolean;
	webSearchResults: Record<string, unknown>[];
	compactionBlocks: Record<string, unknown>[];
	toolResults: Record<string, unknown>[];
	serverToolInputs: Record<string, Record<string, unknown>>;
	currentServerToolId: string | null;
	containerId: string | null;
}

type AnthropicToolChoice =
	| { type: "auto"; disable_parallel_tool_use?: boolean }
	| { type: "any"; disable_parallel_tool_use?: boolean }
	| { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
	| { type: "none" };

interface AnthropicOutputSchema {
	type: "json_schema";
	schema: Record<string, unknown>;
}

interface AnthropicWebSearchTool {
	type: string;
	name: string;
	user_location?: Record<string, unknown>;
	max_uses?: number;
}

interface AnthropicThinkingParam {
	type: string;
	budget_tokens?: number;
}

interface AnthropicSystemMessageContent {
	type: string;
	text: string;
	cache_control?: Record<string, unknown>;
}

/**
 * Anthropic Messages API 提供商
 *
 * 实现 OpenAI -> Anthropic 双向格式转换及 SSE 流解析。
 */
export class AnthropicProvider implements ProviderConfig {
	private _apiBase: string;

	constructor(apiBase = "https://api.anthropic.com") {
		this._apiBase = apiBase;
	}

	// ========== Config ==========

	/**
	 * 获取 Anthropic API 所需的缓存控制请求头
	 */
	getCacheControlHeaders(): Record<string, string> {
		return { "anthropic-version": "2023-06-01" };
	}

	/**
	 * 是否支持流式响应
	 */
	supportsStreaming(): boolean {
		return true;
	}

	/**
	 * 获取 Anthropic 支持的所有请求参数列表
	 */
	getSupportedParams(): string[] {
		return [
			"stream",
			"stop",
			"temperature",
			"top_p",
			"max_tokens",
			"max_completion_tokens",
			"tools",
			"tool_choice",
			"extra_headers",
			"parallel_tool_calls",
			"stop_sequences",
			"response_format",
			"user",
			"web_search_options",
			"speed",
			"context_management",
			"cache_control",
			"api_key",
			"anthropic_version",
			"thinking",
			"reasoning_effort",
			"drop_params",
		];
	}

	// ========== Request: OpenAI -> Anthropic ==========

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const { system, anthropicMessages } = this._toAnthropicMessages(messages);
		const modifyParams = optionalParams.modify_params === true || optionalParams["modify_params"] === true;

		const body: Record<string, unknown> = {
			model: model,
			messages: anthropicMessages,
		};

		// max_tokens: prefer max_completion_tokens, fallback max_tokens, fallback default
		const maxCompletionTokens = optionalParams.max_completion_tokens;
		const maxTokens = optionalParams.max_tokens;
		if (maxCompletionTokens !== undefined) {
			const v = maxCompletionTokens as number;
			body.max_tokens = typeof v === "number" ? Math.max(1, Math.round(v)) : Math.max(1, Math.round(Number(v)));
		} else if (maxTokens !== undefined) {
			const v = maxTokens as number;
			body.max_tokens = typeof v === "number" ? Math.max(1, Math.round(v)) : Math.max(1, Math.round(Number(v)));
		} else {
			body.max_tokens = DEFAULT_ANTHROPIC_CHAT_MAX_TOKENS;
		}

		if (system) {
			body.system = system;
		}

		// Auto-inject code_execution tool if messages contain container_upload
		const hasContainerUpload = (messages as unknown as Record<string, unknown>[]).some((m) => {
			const content = m.content;
			return Array.isArray(content) && content.some((c: Record<string, unknown>) => c.type === "container_upload");
		});
		if (hasContainerUpload) {
			const tools = (Array.isArray(optionalParams.tools) ? optionalParams.tools : []) as Record<string, unknown>[];
			const hasCodeExecution = tools.some(
				(t: Record<string, unknown>) => typeof t.type === "string" && (t.type as string).startsWith("code_execution"),
			);
			if (!hasCodeExecution) {
				tools.push({ type: "code_execution_20250522", name: "code_execution" });
				optionalParams.tools = tools;
			}
		}

		// tools
		if (optionalParams.tools) {
			body.tools = this._mapTools(optionalParams.tools);
		} else if (modifyParams) {
			// Python: inject dummy tool if messages contain tool_calls but no tools param AND modify_params is set (transformation.py:1336-1350)
			const hasToolCallsInMessages = anthropicMessages.some(
				(m) => Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some((c) => c.type === "tool_use"),
			);
			if (hasToolCallsInMessages) {
				body.tools = [
					{ name: "dummy_tool", description: "Auto-injected dummy tool", input_schema: { type: "object", properties: {} } },
				];
			}
		}

		// tool_choice + parallel_tool_calls
		if (optionalParams.tool_choice !== undefined || optionalParams.parallel_tool_calls !== undefined) {
			const tc = this._mapToolChoice(
				optionalParams.tool_choice as string | Record<string, unknown> | undefined,
				optionalParams.parallel_tool_calls as boolean | undefined,
			);
			if (tc) {
				body.tool_choice = tc;
			}
		}

		// thinking / reasoning_effort
		if (optionalParams.thinking) {
			body.thinking = optionalParams.thinking;
		} else if (optionalParams.reasoning_effort) {
			body.thinking = this._mapReasoningEffort(optionalParams.reasoning_effort as string, model);
			if (this._isClaude46Model(model)) {
				const effortMap: Record<string, string> = { low: "low", minimal: "low", medium: "medium", high: "high", max: "max" };
				const effort = optionalParams.reasoning_effort as string;
				body.output_config = { effort: effortMap[effort] ?? effort };
			}
		}

		// PY: output_config effort validation — "max" only supported on Opus 4.6 (transformation.py:1436-1448)
		if (body.output_config) {
			const oc = body.output_config as Record<string, unknown>;
			if (
				oc.effort === "max" &&
				!model.toLowerCase().includes("opus-4-6") &&
				!model.toLowerCase().includes("opus_4_6") &&
				!model.toLowerCase().includes("opus-4.6") &&
				!model.toLowerCase().includes("opus_4.6")
			) {
				oc.effort = "high";
			}
		}

		// thinking validation: if modify_params is set and last assistant has tool_calls but no thinking_blocks, drop thinking param
		// Python: any_assistant_message_has_thinking_blocks check, guarded by litellm.modify_params (transformation.py:1359-1370)
		if (modifyParams && body.thinking && (body.tools || body.tool_choice)) {
			const lastAssistant = [...anthropicMessages].reverse().find((m) => m.role === "assistant") as
				| Record<string, unknown>
				| undefined;
			if (lastAssistant) {
				const content = lastAssistant.content as unknown[] | undefined;
				const hasToolCalls = content?.some((c) => (c as Record<string, unknown>).type === "tool_use");
				const hasThinking = content?.some((c) => {
					const t = (c as Record<string, unknown>).type as string | undefined;
					return t === "thinking" || t === "redacted_thinking";
				});
				if (hasToolCalls && !hasThinking) {
					const anyThinking = anthropicMessages.some((m) => {
						const c = (m as Record<string, unknown>).content as unknown[] | undefined;
						return c?.some((b) => {
							const t = (b as Record<string, unknown>).type as string | undefined;
							return t === "thinking" || t === "redacted_thinking";
						});
					});
					if (!anyThinking) {
						delete body.thinking;
					}
				}
			}
		}

		// web_search_options -> Anthropic hosted web_search tool
		if (optionalParams.web_search_options) {
			const webTool = this._mapWebSearchTool(optionalParams.web_search_options as Record<string, unknown>);
			const existingTools = (body.tools as unknown[]) ?? [];
			body.tools = [...existingTools, webTool];
		}

		// response_format
		if (optionalParams.response_format) {
			const rf = optionalParams.response_format as Record<string, unknown>;
			const nativeModels = [
				"sonnet-4.5",
				"sonnet-4-5",
				"opus-4.1",
				"opus-4-1",
				"opus-4.5",
				"opus-4-5",
				"opus-4.6",
				"opus-4-6",
				"sonnet-4.6",
				"sonnet-4-6",
				"sonnet_4.6",
				"sonnet_4_6",
			];
			if (nativeModels.some((m) => model.includes(m))) {
				const outputFormat = this._mapResponseFormatToAnthropicOutputFormat(rf);
				if (outputFormat) {
					body.output_format = outputFormat;
					body.json_mode = true;
				}
			} else if (rf.type === "text" || rf.type === "ignore") {
				// Python: ignore_response_format_types = ["text"] — 跳过，不做任何处理
			} else if (rf.type === "json_object" || rf.type === "json_schema") {
				const jsonTool = this._createJsonToolCall(rf);
				const existingTools = (body.tools as unknown[]) ?? [];
				body.tools = [...existingTools, jsonTool];
				const isThinkingEnabled = !!body.thinking;
				if (!body.tool_choice && !isThinkingEnabled) {
					body.tool_choice = { type: "tool", name: RESPONSE_FORMAT_TOOL_NAME };
				}
				body.json_mode = true;
			}
		}

		// stop -> stop_sequences
		if (optionalParams.stop !== undefined) {
			const mapped = this._mapStopSequences(optionalParams.stop, !!optionalParams.drop_params);
			if (mapped !== undefined) {
				body.stop_sequences = mapped;
			}
		}

		// passthrough params
		for (const key of ["temperature", "top_p", "stop_sequences", "stream"] as const) {
			if (optionalParams[key] !== undefined && body[key] === undefined) {
				body[key] = optionalParams[key];
			}
		}

		// user_id normalization
		if (optionalParams.user !== undefined) {
			const normalizedUser = this._normalizeUserId(optionalParams.user);
			if (normalizedUser !== undefined) {
				body.metadata = { user_id: normalizedUser };
			}
		}

		const apiKey = optionalParams.api_key as string | undefined;
		const authToken = optionalParams.auth_token as string | undefined; // PY: ANTHROPIC_AUTH_TOKEN -> Bearer
		const anthropicVersion = (optionalParams.anthropic_version as string) ?? "2023-06-01";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"anthropic-version": anthropicVersion,
		};

		const betas: string[] = [];

		// PY alignment: support both x-api-key and Authorization: Bearer (auth_token)
		// Auto-detect OAuth tokens (sk-ant-oat*) and switch auth method
		const effectiveApiKey = authToken ?? apiKey;
		if (effectiveApiKey) {
			if (effectiveApiKey.startsWith("sk-ant-oat")) {
				headers["Authorization"] = `Bearer ${effectiveApiKey}`;
				// PY: inject required OAuth headers (common_utils.py:68,77)
				headers["anthropic-dangerous-direct-browser-access"] = "true";
				betas.push("oauth-2025-04-20");
			} else {
				headers["x-api-key"] = effectiveApiKey;
			}
		}

		// inject anthropic-beta headers (matching Python update_headers_with_optional_anthropic_beta)
		const allTools = body.tools as unknown[] | undefined;
		if (body.output_format) {
			betas.push("structured-outputs-2025-09-25");
		}
		if (body.speed === "fast") {
			betas.push("fast-mode-2026-02-01");
		}
		// web_fetch tools → web-fetch-2025-09-10
		if (
			allTools?.some((t) => {
				const tp = (t as Record<string, unknown>).type as string;
				return tp === "web_fetch" || tp?.startsWith("web_fetch_");
			})
		) {
			betas.push("web-fetch-2025-09-10");
		}
		// memory tools → context-management-2025-06-27
		if (allTools?.some((t) => (t as Record<string, unknown>).name === "memory")) {
			if (!betas.includes("context-management-2025-06-27")) {
				betas.push("context-management-2025-06-27");
			}
		}
		// context_management compaction → compact-2026-01-12
		const cmEdits = (body.context_management as Record<string, unknown> | undefined)?.edits as
			| Array<Record<string, unknown>>
			| undefined;
		if (cmEdits?.some((e) => (e.type as string) === "compact_20260112")) {
			betas.push("compact-2026-01-12");
		} else if (body.context_management) {
			if (!betas.includes("context-management-2025-06-27")) {
				betas.push("context-management-2025-06-27");
			}
		}
		// PY: files-api beta — inject if messages contain "file" content blocks
		const hasFileBlocks = (body.messages as unknown[] | undefined)?.some((m: unknown) => {
			const msg = m as Record<string, unknown>;
			const content = msg.content as unknown[] | undefined;
			return Array.isArray(content) && content.some((c: unknown) => (c as Record<string, unknown>).type === "file");
		});
		if (hasFileBlocks) {
			if (!betas.includes("files-api-2025-05-19")) {
				betas.push("files-api-2025-05-19");
			}
		}
		// PY: code-execution beta for different versions (transformation.py:436-437)
		if (allTools?.some((t) => (((t as Record<string, unknown>).type as string) ?? "").startsWith("code_execution"))) {
			const has20250825 = allTools.some((t) => (t as Record<string, unknown>).type === "code_execution_20250825");
			const execBeta = has20250825 ? "code-execution-2025-08-25" : "code-execution-2025-05-16";
			if (!betas.includes(execBeta)) {
				betas.push(execBeta);
			}
		}
		// PY: mcp-client beta
		if (
			allTools?.some((t) => {
				const tt = (t as Record<string, unknown>).type as string;
				return tt === "mcp_server" || tt === "mcp" || tt === "url" || tt === "mcp_client";
			})
		) {
			if (!betas.includes("mcp-client-2025-10-29")) {
				betas.push("mcp-client-2025-10-29");
			}
		}
		// PY: skills beta
		if (allTools?.some((t) => (t as Record<string, unknown>).type === "tool_search")) {
			if (!betas.includes("tool-search-2025-11-19")) {
				betas.push("tool-search-2025-11-19");
			}
			// PY: skills-2025-10-02 beta for container_with_skills_used (transformation.py:440-441)
			if (!betas.includes("skills-2025-10-02")) {
				betas.push("skills-2025-10-02");
			}
		}
		// PY: effort beta header for Claude 4.5+ models with reasoning
		if (body.output_config && (body.output_config as Record<string, unknown>).effort) {
			const isVertex = (optionalParams.custom_llm_provider as string) === "vertex_ai" || model.toLowerCase().includes("vertex");
			if (!isVertex) {
				betas.push("effort-2025-11-24");
			}
		}

		// PY alignment: check for user-provided anthropic-beta in extra_headers and merge
		const userAnthropicBeta = (optionalParams.extra_headers as Record<string, string> | undefined)?.["anthropic-beta"];
		if (userAnthropicBeta) {
			for (const b of userAnthropicBeta.split(",").map((s) => s.trim())) {
				if (b && !betas.includes(b)) {
					betas.push(b);
				}
			}
		}

		if (betas.length > 0) {
			// PY: Vertex AI skips most beta headers (transformation.py:1282-1286, common_utils.py:462-469)
			const isVertex = (optionalParams.custom_llm_provider as string) === "vertex_ai" || model.toLowerCase().includes("vertex");
			if (!isVertex) {
				headers["anthropic-beta"] = betas.join(",");
			} else if (allTools?.some((t) => (((t as Record<string, unknown>).type as string) ?? "").startsWith("web_search"))) {
				// PY: Vertex requires web_search beta header for web search to work
				headers["anthropic-beta"] = "web-search-2025-03-05";
			}
		}

		// extra_headers — inject into HTTP headers, NOT body
		if (optionalParams.extra_headers) {
			const extra = optionalParams.extra_headers as Record<string, string>;
			for (const [k, v] of Object.entries(extra)) {
				if (k === "anthropic-beta") {
					continue; // already merged above
				}
				if (k.toLowerCase().startsWith("anthropic-") || k.toLowerCase().startsWith("x-")) {
					headers[k] = v;
				}
			}
		}

		// context_management
		if (optionalParams.context_management) {
			const cm = this._mapOpenAIContextManagementToAnthropic(optionalParams.context_management);
			if (cm !== null) {
				body.context_management = cm;
			}
		}

		// speed
		if (optionalParams.speed) {
			body.speed = optionalParams.speed;
		}

		// top-level cache_control
		if (optionalParams.cache_control) {
			body.cache_control = optionalParams.cache_control;
		}

		return {
			url: `${this._apiBase}/v1/messages`,
			method: "POST",
			headers: headers,
			body: body,
			model: model,
			stream: optionalParams.stream as boolean | undefined,
		};
	}

	// ========== Response: Anthropic -> OpenAI (non-streaming) ==========

	/**
	 * @param model
	 * @param rawResponse
	 * @param usage
	 */
	transformResponse(
		model: string,
		rawResponse: unknown,
		usage?: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		},
	): ModelResponse {
		const raw = rawResponse as Record<string, unknown>;
		const id = (raw.id as string) ?? `anthropic-${Date.now()}`;
		const respModel = (raw.model as string) ?? model;

		const contentBlocks = (raw.content as AnthropicContentBlock[]) ?? [];
		const textContent = this._extractTextWithPrefix(contentBlocks);
		const toolCalls = this._extractToolCalls(contentBlocks);
		const thinkingBlocks = this._extractThinkingBlocks(contentBlocks);
		const reasoningContent = thinkingBlocks.length > 0 ? thinkingBlocks.map((b) => b.thinking ?? "").join("") : undefined;

		const stopReason = (raw.stop_reason as string) ?? "end_turn";
		const mappedStopReason =
			stopReason === "end_turn"
				? "stop"
				: stopReason === "tool_use"
					? "tool_calls"
					: stopReason === "max_tokens"
						? "length"
						: stopReason === "stop_sequence"
							? "stop"
							: stopReason === "refusal"
								? "content_filter"
								: stopReason === "content_filtered"
									? "content_filter"
									: stopReason === "compaction"
										? "length"
										: stopReason;

		const citations = this._extractCitations(contentBlocks);

		const providerSpecificFields: Record<string, unknown> = {};
		if (citations.length > 0) {
			providerSpecificFields.citations = citations;
		}
		if (thinkingBlocks.length > 0) {
			providerSpecificFields.thinking_blocks = thinkingBlocks;
		}
		// PY: container and code_interpreter_results (transformation.py:1691-1729,1764-1770)
		const containerBlocks = this._extractContainerContent(contentBlocks);
		if (containerBlocks.length > 0) {
			providerSpecificFields.container_content = containerBlocks;
		}
		const codeInterpreterResults = this._extractCodeInterpreterResults(contentBlocks);
		if (codeInterpreterResults.length > 0) {
			providerSpecificFields.code_interpreter_results = codeInterpreterResults;
		}
		// PY: extract compaction blocks (transformation.py:1543-1546,1776-1777)
		const compactionBlocks = this._extractCompactionBlocks(contentBlocks);
		if (compactionBlocks.length > 0) {
			providerSpecificFields.compaction_blocks = compactionBlocks;
		}

		const jsonMode = (raw as Record<string, unknown>).json_mode as boolean | undefined;
		let messageContent: string | null = textContent;
		const isJsonTool = toolCalls.length === 1 && toolCalls[0]!.function.name === RESPONSE_FORMAT_TOOL_NAME;
		if (jsonMode && isJsonTool) {
			const converted = this._convertToolResponseToMessage(toolCalls);
			if (converted !== null) {
				messageContent = converted;
				toolCalls.length = 0;
			}
		}

		const extractedUsage = this._extractUsage(raw);

		// TypeScript: ensure the usage object always has required fields
		const resolvedUsage: Record<string, unknown> =
			usage !== undefined
				? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens }
				: ({
						prompt_tokens: extractedUsage.prompt_tokens,
						completion_tokens: extractedUsage.completion_tokens,
						total_tokens: extractedUsage.total_tokens,
					} as Record<string, unknown>);
		const hasExtraUsageFields =
			extractedUsage.cache_creation_input_tokens > 0 ||
			extractedUsage.cache_read_input_tokens > 0 ||
			(extractedUsage.completion_tokens_details?.reasoning_tokens ?? 0) > 0 ||
			extractedUsage.web_search_requests > 0 ||
			extractedUsage.tool_search_requests > 0;
		if (hasExtraUsageFields) {
			const extra: Record<string, unknown> = {
				completion_tokens_details: extractedUsage.completion_tokens_details,
				prompt_tokens_details: extractedUsage.prompt_tokens_details,
				cache_creation_input_tokens: extractedUsage.cache_creation_input_tokens,
				cache_read_input_tokens: extractedUsage.cache_read_input_tokens,
			};
			// PY: server_tool_use info (transformation.py:1596-1625,1676-1684)
			if (extractedUsage.web_search_requests > 0) {
				extra.web_search_requests = extractedUsage.web_search_requests;
			}
			// PY: tool_search_requests fallback (transformation.py:1627-1637)
			let toolSearchRequestsVal = extractedUsage.tool_search_requests;
			if (toolSearchRequestsVal === 0) {
				toolSearchRequestsVal = contentBlocks.filter((b) => b.type === "server_tool_use" && b.name?.includes("tool_search")).length;
			}
			if (toolSearchRequestsVal > 0) {
				extra.tool_search_requests = toolSearchRequestsVal;
			}
			if (extractedUsage.inference_geo !== undefined) {
				extra.inference_geo = extractedUsage.inference_geo;
			}
			if (extractedUsage.speed !== undefined) {
				extra.speed = extractedUsage.speed;
			}
			// PY: cache_creation_token_details — ephemeral durations (transformation.py:1639-1647)
			if (extractedUsage.cache_creation_token_details) {
				extra.cache_creation_token_details = extractedUsage.cache_creation_token_details;
			}
			Object.assign(resolvedUsage, extra);
		}

		return {
			id: id,
			created: Math.floor(Date.now() / 1000),
			model: respModel,
			object: "chat.completion",
			choices: [
				{
					finish_reason: mappedStopReason,
					index: 0,
					message: {
						content: messageContent,
						role: "assistant",
						...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
						...(reasoningContent !== undefined ? { reasoning_content: reasoningContent } : {}),
						...(thinkingBlocks.length > 0 ? { thinking_blocks: thinkingBlocks } : {}),
					},
				},
			],
			usage: resolvedUsage as unknown as Usage,
			_hidden_params: {
				provider_specific_fields: providerSpecificFields,
			},
		};
	}

	// ========== Streaming ==========

	/**
	 * @param response
	 * @yields ModelResponseStream chunks
	 */
	async *streamResponse(response: Response): AsyncGenerator<ModelResponseStream> {
		const reader = response.body?.getReader();
		if (!reader) {
			return;
		}

		const decoder = new TextDecoder();
		let buffer = "";
		const state: StreamState = {
			responseId: "",
			responseModel: "",
			created: Math.floor(Date.now() / 1000),
			toolUseIndexOffset: 0,
			jsonFragments: {},
			stopReason: null,
			jsonMode: false,
			isResponseFormatTool: false,
			webSearchResults: [],
			compactionBlocks: [],
			toolResults: [],
			serverToolInputs: {},
			currentServerToolId: null,
			containerId: null,
		};

		let hasMessageDelta = false;
		let hadRealContent = false;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				let currentData = "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed.startsWith("data: ")) {
						currentData = trimmed.slice(6);
					} else if (trimmed === "data: " || trimmed === "data:") {
						currentData = "";
					} else {
						continue;
					}

					if (!currentData) {
						continue;
					}

					try {
						// PY: handle accumulated JSON chunks for network fragmentation
						let parsed: Record<string, unknown>;
						try {
							parsed = JSON.parse(currentData) as Record<string, unknown>;
							state._accumulatedJson = undefined;
						} catch {
							state._accumulatedJson = (state._accumulatedJson ?? "") + currentData;
							try {
								parsed = JSON.parse(state._accumulatedJson) as Record<string, unknown>;
								state._accumulatedJson = undefined;
							} catch {
								continue;
							}
						}

						// Error events
						if (parsed.type === "error") {
							const error = parsed.error as Record<string, unknown> | undefined;
							throw new AnthropicError(
								(error?.message as string) ?? "Unknown Anthropic error",
								(error?.type as string) ?? "unknown",
							);
						}

						const sseEvent = parsed as AnthropicSSEEvent & Record<string, unknown>;
						for (const chunk of this._parseAnthropicSSE(sseEvent, state)) {
							if (chunk.id) {
								state.responseId = chunk.id;
							}
							if (chunk.model) {
								state.responseModel = chunk.model;
							}
							if (chunk.created) {
								state.created = chunk.created;
							}

							if (parsed.type === "content_block_start" || parsed.type === "content_block_delta") {
								hadRealContent = true;
							}
							if (parsed.type === "message_delta") {
								hasMessageDelta = true;
							}

							const { _toolUseIndexOffset, _isFinal, usage: _u, ...clean } = chunk as StreamInternal;
							// Clean surrogates from delta content and reasoning_content
							if (clean.choices?.[0]?.delta) {
								const delta = clean.choices[0].delta;
								if (delta.content) {
									delta.content = cleanSurrogates(delta.content);
								}
								if (delta.reasoning_content) {
									delta.reasoning_content = cleanSurrogates(delta.reasoning_content);
								}
							}
							yield clean;
						}
					} catch (e) {
						if (e instanceof AnthropicError) {
							throw e;
						}
					}

					currentData = "";
				}
			}

			// Defensive: synthesize message_delta if stream ended without it
			if (!hasMessageDelta && state.responseId && hadRealContent) {
				yield {
					id: state.responseId,
					object: "chat.completion.chunk",
					created: state.created,
					model: state.responseModel,
					choices: [{ index: 0, delta: {}, finish_reason: state.stopReason ?? "stop" }],
				};
			}
		} finally {
			reader.releaseLock();
		}
	}

	// ========== SSE parsing ==========

	private _parseAnthropicSSE(event: Record<string, unknown>, state: StreamState): StreamInternal[] {
		const type = event.type as string;

		if (type === "message_start") {
			const msg = event.message as Record<string, unknown> | undefined;
			if (!msg) {
				return [];
			}
			return [
				{
					id: (msg.id as string) ?? "",
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: (msg.model as string) ?? "",
					choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
					usage: {
						prompt_tokens: ((msg.usage as Record<string, number>)?.input_tokens ?? 0) as number,
						completion_tokens: 0,
						total_tokens: ((msg.usage as Record<string, number>)?.input_tokens ?? 0) as number,
					},
				},
			];
		}

		if (type === "content_block_start") {
			const index = event.index as number;
			const block = event.content_block as Record<string, unknown> | undefined;
			if (!block) {
				return [];
			}
			const blockType = block.type as string;

			if (blockType === "text") {
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { content: (block.text as string) ?? "" }, finish_reason: null }],
					},
				];
			}
			// PY: compaction block (handler.py:827-839)
			if (blockType === "compaction") {
				state.compactionBlocks.push(block);
				const contentText = (block.content as string) ?? "";
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									content: contentText,
									provider_specific_fields: { compaction_blocks: [...state.compactionBlocks] },
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			// PY: tool_result blocks (handler.py:841-876)
			if (typeof blockType === "string" && blockType.endsWith("_tool_result")) {
				const psf: Record<string, unknown> = {};
				if (blockType === "web_search_tool_result" || blockType === "web_fetch_tool_result") {
					state.webSearchResults.push(block);
					psf.web_search_results = [...state.webSearchResults];
				} else if (blockType !== "tool_search_tool_result") {
					state.toolResults.push(block);
					psf.tool_results = [...state.toolResults];
					psf.code_interpreter_results = this._buildCodeInterpreterResultsForStream(state);
				}
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { provider_specific_fields: psf }, finish_reason: null }],
					},
				];
			}
			if (blockType === "tool_use" || blockType === "server_tool_use") {
				if (state.toolUseIndexOffset === 0 && index > 0) {
					state.toolUseIndexOffset = index;
				}
				const toolIndex = index - state.toolUseIndexOffset;
				state.jsonFragments[toolIndex] = "";
				// PY: json mode streaming (handler.py:1031-1036)
				const toolName = (block.name as string) ?? "";
				if (toolName === RESPONSE_FORMAT_TOOL_NAME) {
					state.isResponseFormatTool = true;
					state.jsonMode = true;
					return [
						{
							id: state.responseId,
							object: "chat.completion.chunk",
							created: state.created,
							model: state.responseModel,
							choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
						},
					];
				}
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									content: null,
									tool_calls: [
										{
											index: toolIndex,
											id: (block.id as string) ?? "",
											function: { name: (block.name as string) ?? "", arguments: "" },
										},
									],
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			if (blockType === "thinking" || blockType === "redacted_thinking") {
				const thinkingText = (block.thinking as string) ?? "";
				const signature = (block.signature as string) ?? "";
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									reasoning_content: thinkingText,
									thinking_blocks: [
										{
											type: blockType as "thinking" | "redacted_thinking",
											thinking: thinkingText,
											signature: signature,
										},
									],
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			return [];
		}

		if (type === "content_block_delta") {
			const index = event.index as number;
			const delta = event.delta as Record<string, unknown> | undefined;
			if (!delta) {
				return [];
			}
			const deltaType = delta.type as string;

			if (deltaType === "text_delta") {
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { content: (delta.text as string) ?? "" }, finish_reason: null }],
					},
				];
			}
			if (deltaType === "input_json_delta") {
				const toolIndex = index - state.toolUseIndexOffset;
				const partial = (delta.partial_json as string) ?? "";
				if (state.jsonFragments[toolIndex] !== undefined) {
					state.jsonFragments[toolIndex] += partial;
				} else {
					state.jsonFragments[toolIndex] = partial;
				}
				// PY: json mode streaming (handler.py:1038-1049)
				if (state.isResponseFormatTool) {
					return [
						{
							id: state.responseId,
							object: "chat.completion.chunk",
							created: state.created,
							model: state.responseModel,
							choices: [{ index: 0, delta: { content: partial }, finish_reason: null }],
						},
					];
				}
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									content: null,
									tool_calls: [{ index: toolIndex, function: { arguments: partial } }],
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			if (deltaType === "thinking_delta") {
				const thinkingText = (delta.thinking as string) ?? "";
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { reasoning_content: thinkingText }, finish_reason: null }],
					},
				];
			}
			if (deltaType === "signature_delta") {
				const sigText = (delta.signature as string) ?? "";
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									reasoning_content: "",
									thinking_blocks: [{ type: "thinking" as const, thinking: "", signature: sigText }],
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			if (deltaType === "citation_delta") {
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
					},
				];
			}
			if (deltaType === "compaction_delta") {
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
					},
				];
			}
			return [];
		}

		if (type === "content_block_stop") {
			// Check for empty tool call args
			const index = event.index as number;
			const toolIndex = index - state.toolUseIndexOffset;
			const accumulated = state.jsonFragments[toolIndex];
			if (accumulated === "" && state.jsonFragments[toolIndex] !== undefined) {
				state.jsonFragments[toolIndex] = "{}";
				return [
					{
						id: state.responseId,
						object: "chat.completion.chunk",
						created: state.created,
						model: state.responseModel,
						choices: [
							{
								index: 0,
								delta: {
									content: null,
									tool_calls: [{ index: toolIndex, function: { arguments: "{}" } }],
								},
								finish_reason: null,
							},
						],
					},
				];
			}
			// PY: reset response_format tool tracking on block stop (handler.py:913-914)
			state.isResponseFormatTool = false;
			return [];
		}
		if (type === "message_stop" || type === "ping") {
			return [];
		}

		if (type === "message_delta") {
			const msgDelta = event.delta as Record<string, unknown> | undefined;
			const usageInfo = event.usage as Record<string, number> | undefined;
			const stopReason = msgDelta?.stop_reason as string | undefined;
			const container = msgDelta?.container as Record<string, unknown> | undefined;
			const mapped: string | null =
				stopReason === "end_turn"
					? "stop"
					: stopReason === "tool_use"
						? "tool_calls"
						: stopReason === "max_tokens"
							? "length"
							: stopReason === "stop_sequence"
								? "stop"
								: stopReason === "refusal"
									? "content_filter"
									: stopReason === "content_filtered"
										? "content_filter"
										: stopReason === "compaction"
											? "length"
											: (stopReason ?? null);

			if (stopReason) {
				state.stopReason = stopReason;
			}
			// PY: container handling (handler.py:923-935)
			if (container) {
				const containerId = (container.id as string) ?? null;
				if (containerId && state.toolResults.length > 0) {
					state.containerId = containerId;
				}
			}

			const promptTokens = ((event.message as Record<string, unknown>)?.usage as Record<string, number>)?.input_tokens ?? 0;
			const outputTokens = usageInfo?.output_tokens ?? 0;

			return [
				{
					id: state.responseId,
					object: "chat.completion.chunk",
					created: state.created,
					model: state.responseModel,
					choices: [{ index: 0, delta: {}, finish_reason: mapped }],
					usage: {
						prompt_tokens: promptTokens,
						completion_tokens: outputTokens,
						total_tokens: promptTokens + outputTokens,
					},
				},
			];
		}

		// Silently skip reasoning events that should not propagate to the user
		if (
			type === "reasoning_text.done" ||
			type === "reasoning_part.done" ||
			type === "reasoning_summary_text.done" ||
			type === "reasoning_summary.done"
		) {
			return [];
		}

		return [];
	}

	// ========== OpenAI -> Anthropic message conversion ==========

	private _toAnthropicMessages(messages: Message[]): {
		system?: string | AnthropicSystemMessageContent[];

		anthropicMessages: Array<{
			role: string;
			content: unknown;
		}>;
	} {
		const systemList: AnthropicSystemMessageContent[] = [];
		const result: Array<{
			role: string;
			content: unknown;
		}> = [];

		for (const msg of messages) {
			if (msg.role === "system") {
				const storedCacheControl = (msg as unknown as Record<string, unknown>).cache_control as Record<string, unknown> | undefined;
				if (typeof msg.content === "string") {
					if (!msg.content) {
						continue;
					}
					if (msg.content.startsWith("x-anthropic-billing-header:")) {
						continue;
					}
					const entry: AnthropicSystemMessageContent = { type: "text", text: msg.content };
					if (storedCacheControl) {
						entry.cache_control = storedCacheControl;
					}
					systemList.push(entry);
				} else if (Array.isArray(msg.content)) {
					for (const sub of msg.content as Array<Record<string, unknown>>) {
						const textValue = sub.text as string | undefined;
						if (sub.type === "text" && !textValue) {
							continue;
						}
						if (sub.type === "text" && textValue && textValue.startsWith("x-anthropic-billing-header:")) {
							continue;
						}
						const entry: AnthropicSystemMessageContent = { type: (sub.type as string) ?? "text", text: textValue ?? "" };
						if (sub.cache_control) {
							entry.cache_control = sub.cache_control as Record<string, unknown>;
						}
						systemList.push(entry);
					}
				}
				continue;
			}
			if (msg.role === "tool") {
				const toolMsg = msg as unknown as Record<string, unknown>;
				const toolCallId = toolMsg.tool_call_id as string;
				const content = toolMsg.content;
				if (Array.isArray(content)) {
					result.push({
						role: "user",
						content: [{ type: "tool_result", tool_use_id: toolCallId, content: content as unknown[] }],
					});
				} else {
					result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolCallId, content: content ?? "" }] });
				}
				continue;
			}
			if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
				const content: AnthropicContentBlock[] = [];
				const storedRefusal = (msg as unknown as Record<string, unknown>).refusal;
				if (msg.content || storedRefusal) {
					content.push({ type: "text", text: msg.content ?? "" });
				}
				for (const tc of msg.tool_calls) {
					let input: Record<string, unknown>;
					try {
						input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
					} catch {
						input = {};
					}
					content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: input } as AnthropicContentBlock);
				}
				const storedCacheControl = (msg as unknown as Record<string, unknown>).cache_control as Record<string, unknown> | undefined;
				const resultEntry: Record<string, unknown> = { role: "assistant", content: content };
				if (storedCacheControl) {
					resultEntry.cache_control = storedCacheControl;
				}
				result.push(
					resultEntry as {
						role: string;
						content: unknown;
					},
				);
				continue;
			}
			// user message with potential image content
			if (msg.role === "user" && Array.isArray(msg.content)) {
				const contentParts: unknown[] = [];
				for (const part of msg.content as Array<Record<string, unknown>>) {
					if (part.type === "image_url") {
						const imageUrl = part.image_url as Record<string, unknown> | undefined;
						if (imageUrl) {
							const url = imageUrl.url as string | undefined;
							if (url && url.startsWith("data:image/")) {
								const match = /^data:image\/([a-zA-Z0-9]+);base64,(.+)$/.exec(url);
								if (match) {
									contentParts.push({
										type: "image",
										source: { type: "base64", media_type: `image/${match[1]}`, data: match[2] },
									});
								} else {
									contentParts.push(part);
								}
							} else if (url) {
								contentParts.push({ type: "text", text: `[Image: ${url}]` });
							}
						}
					} else if (part.type === "text") {
						contentParts.push(part);
					} else {
						contentParts.push(part);
					}
				}
				result.push({ role: msg.role, content: contentParts.length > 0 ? contentParts : [{ type: "text", text: "" }] });
				continue;
			}
			result.push({ role: msg.role, content: [{ type: "text", text: msg.content ?? "" }] });
		}

		const systemResult: string | AnthropicSystemMessageContent[] | undefined = systemList.length > 0 ? systemList : undefined;

		return { system: systemResult, anthropicMessages: result };
	}

	// ========== Tool choice mapping ==========

	private _mapToolChoice(
		toolChoice: string | Record<string, unknown> | undefined,
		parallelToolCalls: boolean | undefined,
	): AnthropicToolChoice | undefined {
		let tc: AnthropicToolChoice | undefined;

		if (typeof toolChoice === "string") {
			switch (toolChoice) {
				case "auto":
					tc = { type: "auto" };
					break;
				case "required":
					tc = { type: "any" };
					break;
				case "none":
					tc = { type: "none" };
					break;
				default:
					// Python returns None for unknown string tool_choice
					break;
			}
		} else if (typeof toolChoice === "object" && toolChoice !== null) {
			const tcObj = toolChoice as Record<string, unknown>;
			if ("type" in tcObj && !("function" in tcObj)) {
				const type = tcObj.type as string;
				if (type === "auto") {
					tc = { type: "auto" };
				} else if (type === "any" || type === "required") {
					tc = { type: "any" };
				} else if (type === "none") {
					tc = { type: "none" };
				} else if (type === "tool") {
					tc = { type: "tool", name: (tcObj.name as string) ?? "unknown" };
				}
			} else {
				const fnName = (tcObj.function as Record<string, unknown> | undefined)?.name as string | undefined;
				if (fnName) {
					tc = { type: "tool", name: fnName };
				}
			}
		}
		if (parallelToolCalls !== undefined && tc) {
			if (typeof toolChoice === "string" ? toolChoice !== "none" : tc.type !== "none") {
				(tc as Record<string, unknown>)["disable_parallel_tool_use"] = !parallelToolCalls;
			}
		} else if (parallelToolCalls !== undefined && !tc) {
			tc = { type: "auto", disable_parallel_tool_use: !parallelToolCalls };
		}

		return tc;
	}

	// ========== Tool definition mapping ==========

	/**
	 * PY: Separate deferred tools (defer_loading: true) from non-deferred.
	 * Deferred tools are moved to a separate list; tool references point to them.
	 * (transformation.py:659-720)
	 * @param tools
	 */
	private _separateDeferredTools(tools: unknown[]): { active: unknown[]; deferred: unknown[] } {
		const active: unknown[] = [];
		const deferred: unknown[] = [];
		for (const t of tools) {
			const tool = t as Record<string, unknown>;
			if (tool.defer_loading || (tool.function as Record<string, unknown> | undefined)?.defer_loading) {
				deferred.push(t);
			} else {
				active.push(t);
			}
		}
		return { active: active, deferred: deferred };
	}

	/**
	 * PY: Expand tool references. If a tool has a "tool_reference" field, look up
	 * the referenced tool in the deferred list and inline it.
	 * @param active
	 * @param deferred
	 */
	private _expandToolReferences(active: unknown[], deferred: unknown[]): unknown[] {
		const deferredByName = new Map<string, unknown>();
		for (const d of deferred) {
			const dTool = d as Record<string, unknown>;
			const name = (dTool.name as string) || ((dTool.function as Record<string, unknown> | undefined)?.name as string);
			if (name) {
				deferredByName.set(name, d);
			}
		}
		const expanded: unknown[] = [];
		for (const t of active) {
			const tool = t as Record<string, unknown>;
			const ref = tool.tool_reference as string | undefined;
			if (ref && deferredByName.has(ref)) {
				const refTool = deferredByName.get(ref) as Record<string, unknown>;
				const merged = { ...refTool, ...tool };
				expanded.push(merged);
			} else {
				expanded.push(t);
			}
		}
		return expanded;
	}

	private _mapTools(tools: unknown): unknown[] {
		const toolsArr = tools as unknown[];
		// PY: separate deferred tools before mapping (transformation.py:659-720)
		const { active, deferred } = this._separateDeferredTools(toolsArr);
		// PY: expand tool references (transformation.py:659-720)
		const expanded = this._expandToolReferences(active, deferred);

		const transformed: unknown[] = [];
		for (const t of expanded) {
			const tool = t as Record<string, unknown>;

			// Pass through native Anthropic tool types
			const nativeTypes = [
				"computer_20250124",
				"computer_20250305",
				"computer_use",
				"text_editor_20250124",
				"text_editor_20250305",
				"mcp_server",
				"mcp",
				"tool_search",
				"tool_search_2025",
				"code_execution_20250522",
				"code_execution_20250825",
				"tool_search_tool_regex_20251119",
				"tool_search_tool_bm25_20251119",
				"web_search",
				"web_fetch",
				"memory",
			];
			if (typeof tool.type === "string" && nativeTypes.includes(tool.type)) {
				// PY: computer_ type validation - display params from function.parameters (transformation.py:439-466)
				if (tool.type === "computer_20250124" || tool.type === "computer_20250305" || tool.type === "computer_use") {
					const fnParams = (tool.function as Record<string, unknown> | undefined)?.parameters as
						| Record<string, unknown>
						| undefined;
					const dw = typeof tool.display_width_px === "number" ? tool.display_width_px : fnParams?.display_width_px;
					const dh = typeof tool.display_height_px === "number" ? tool.display_height_px : fnParams?.display_height_px;
					if (typeof dw !== "number" || typeof dh !== "number") {
						throw new Error(
							`Computer tool requires display_width_px and display_height_px (got w=${String(dw)}, h=${String(dh)})`,
						);
					}
				}
				const mapped: Record<string, unknown> = { ...tool } as Record<string, unknown>;
				// PY: handle display_number on mapped (transformation.py:462-464)
				const isCompType = tool.type === "computer_20250124" || tool.type === "computer_20250305" || tool.type === "computer_use";
				if (isCompType) {
					const fnParams2 = (tool.function as Record<string, unknown> | undefined)?.parameters as
						| Record<string, unknown>
						| undefined;
					const dn2 = typeof tool.display_number === "number" ? tool.display_number : fnParams2?.display_number;
					if (dn2 !== undefined) {
						mapped.display_number = dn2;
					}
				}
				// PY: exclude cache_control on tool_search tools (transformation.py:514-531)
				const isToolSearch = typeof tool.type === "string" && tool.type.includes("tool_search");
				if (isToolSearch && mapped.cache_control !== undefined) {
					delete mapped.cache_control;
				}
				// PY: exclude defer_loading on computer types, exclude allowed_callers on computer/tool_search (transformation.py:533-579)
				const isComputerType = isCompType;
				if (tool.defer_loading !== undefined && !isComputerType) {
					mapped.defer_loading = tool.defer_loading;
				}
				if (tool.allowed_callers !== undefined && !(isComputerType || isToolSearch)) {
					mapped.allowed_callers = tool.allowed_callers;
				}
				// PY: input_examples only for custom tools (transformation.py:581-593)
				// Skip for native types
				transformed.push(mapped);
				continue;
			}

			// PY: type="url" -> MCP Server tool (transformation.py:481-486,597-626)
			if (tool.type === "url") {
				const mapped: Record<string, unknown> = {
					type: "url_2025_08",
					name: (tool.name as string) ?? "",
					url: (tool.url as string) ?? ((tool as Record<string, unknown>).server_url as string),
				};
				if (tool.description) {
					mapped.description = tool.description;
				}
				transformed.push(mapped);
				continue;
			}

			// PY: type="mcp" / mcp_client -> MCP Server tool (transformation.py:597-626)
			if (tool.type === "mcp_client") {
				const mapped: Record<string, unknown> = {
					type: "mcp_client_2025_10",
					name: (tool.name as string) ?? (tool.id as string) ?? "",
					identifier: (tool.identifier as string) ?? (tool.id as string) ?? "",
				};
				if (tool.description) {
					mapped.description = tool.description;
				}
				transformed.push(mapped);
				continue;
			}

			if (tool.input_schema) {
				const mapped = { ...(tool as Record<string, unknown>) } as Record<string, unknown>;
				// PY: filter input_schema to Anthropic-supported fields (transformation.py:419-425)
				// Uses a lighter filter that only strips unsupported constraints without adding additionalProperties
				mapped.input_schema = this._filterToolInputSchema(mapped.input_schema as Record<string, unknown>);
				// PY: defer_loading, allowed_callers, input_examples passthrough (transformation.py:533-593)
				if (tool.defer_loading !== undefined) {
					mapped.defer_loading = tool.defer_loading;
				}
				if (tool.allowed_callers !== undefined) {
					mapped.allowed_callers = tool.allowed_callers;
				}
				if (tool.input_examples !== undefined) {
					mapped.input_examples = tool.input_examples;
				}
				transformed.push(mapped);
				continue;
			}
			if (tool.type === "function") {
				const fn = tool.function as Record<string, unknown> | undefined;
				if (!fn) {
					transformed.push(tool);
					continue;
				}
				const inputSchema = { ...((fn.parameters as Record<string, unknown>) ?? {}) };
				if (inputSchema.type !== "object") {
					inputSchema.type = "object";
				}
				if (!inputSchema.properties) {
					inputSchema.properties = {};
				}
				const mapped: Record<string, unknown> = { name: fn.name ?? "", input_schema: inputSchema };
				if (fn.description) {
					mapped.description = fn.description as string;
				}
				if ((fn as Record<string, unknown>).cache_control) {
					mapped.cache_control = (fn as Record<string, unknown>).cache_control;
				}
				// PY: defer_loading, allowed_callers, input_examples passthrough (transformation.py:533-593)
				if ((fn as Record<string, unknown>).defer_loading !== undefined) {
					mapped.defer_loading = (fn as Record<string, unknown>).defer_loading;
				}
				if ((fn as Record<string, unknown>).allowed_callers !== undefined) {
					mapped.allowed_callers = (fn as Record<string, unknown>).allowed_callers;
				}
				// PY: input_examples only for custom tools (transformation.py:581-593)
				// Already handled via function -> custom tool mapping
				transformed.push(mapped);
				continue;
			}
			transformed.push(t);
		}
		// Append deferred tools to the end (PY: transformation.py:714-720)
		for (const d of deferred) {
			transformed.push(d);
		}
		return transformed;
	}

	// ========== JSON tool call for response_format ==========

	private _createJsonToolCall(responseFormat: Record<string, unknown>): Record<string, unknown> {
		const name = (responseFormat.name as string) ?? RESPONSE_FORMAT_TOOL_NAME;
		const schema = (responseFormat.json_schema as Record<string, unknown> | undefined) ?? { type: "object" };
		const inputSchema: Record<string, unknown> = { type: "object" };
		if (schema.schema) {
			const rawSchema = schema.schema as Record<string, unknown>;
			if (rawSchema.properties || rawSchema.type === "object") {
				Object.assign(inputSchema, rawSchema);
			} else {
				inputSchema.properties = rawSchema;
			}
		} else if (schema.properties) {
			Object.assign(inputSchema, schema);
		} else {
			inputSchema.additionalProperties = true;
			inputSchema.properties = {};
		}
		return { name: name, description: "JSON output", input_schema: inputSchema };
	}

	// ========== Web search tool mapping ==========

	private _mapWebSearchTool(value: Record<string, unknown>): AnthropicWebSearchTool {
		const tool: AnthropicWebSearchTool = { type: "web_search_20250305", name: "web_search" };
		const userLocation = value.user_location as Record<string, unknown> | undefined;
		if (userLocation) {
			const approximate = userLocation.approximate as Record<string, unknown> | undefined;
			if (approximate) {
				const anthropicLocation: Record<string, unknown> = { type: "approximate" };
				for (const key of ["country", "city", "region", "timezone"] as const) {
					if (approximate[key] !== undefined) {
						anthropicLocation[key] = approximate[key];
					}
				}
				tool.user_location = anthropicLocation;
			}
		}
		const searchContextSize = value.search_context_size as string | undefined;
		if (searchContextSize) {
			const maxUsesMap: Record<string, number> = { low: 1, medium: 5, high: 10 };
			if (maxUsesMap[searchContextSize] !== undefined) {
				tool.max_uses = maxUsesMap[searchContextSize];
			}
		}
		return tool;
	}

	// ========== Native output_format mapping ==========

	private _mapResponseFormatToAnthropicOutputFormat(value: Record<string, unknown>): AnthropicOutputSchema | null {
		if (!value || value.type === "text") {
			return null;
		}
		let jsonSchema: Record<string, unknown> | undefined;
		if (value.response_schema) {
			jsonSchema = value.response_schema as Record<string, unknown>;
		} else if (value.json_schema) {
			const js = value.json_schema as Record<string, unknown>;
			jsonSchema = (js.schema as Record<string, unknown>) ?? js;
		}
		if (!jsonSchema) {
			return null;
		}
		const resolved = this._resolveDefs(jsonSchema);
		const filtered = this._filterAnthropicOutputSchema(resolved);
		return { type: "json_schema", schema: filtered };
	}

	// ========== $defs / definitions resolution ==========

	private _resolveDefs(schema: Record<string, unknown>): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const defs: Record<string, unknown> = {};
		if (schema.$defs) {
			Object.assign(defs, schema.$defs as Record<string, unknown>);
		}
		if (schema.definitions) {
			Object.assign(defs, schema.definitions as Record<string, unknown>);
		}

		const resolveRef = (val: unknown): unknown => {
			if (typeof val === "string") {
				for (const [prefix, offset] of [
					["/$defs/", 7],
					["#/$defs/", 8],
					["/definitions/", 13],
					["#/definitions/", 14],
				] as const) {
					if (val.startsWith(prefix)) {
						const key = val.slice(offset);
						return defs[key] ?? val;
					}
				}
			}
			return val;
		};

		const deepResolve = (val: unknown): unknown => {
			if (Array.isArray(val)) {
				return val.map(deepResolve);
			}
			if (val && typeof val === "object") {
				const obj: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
					if (k === "$ref") {
						const resolved = resolveRef(v);
						if (resolved !== v && typeof resolved === "object") {
							Object.assign(obj, deepResolve(resolved) as Record<string, unknown>);
						} else {
							obj[k] = v;
						}
					} else if (k !== "$defs" && k !== "definitions") {
						obj[k] = deepResolve(v);
					}
				}
				return obj;
			}
			return val;
		};

		for (const [k, v] of Object.entries(schema)) {
			if (k === "$defs" || k === "definitions") {
				continue;
			}
			result[k] = deepResolve(v);
		}
		return result;
	}

	// ========== Schema filtering for Anthropic ==========

	private _filterAnthropicOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
		if (!schema || typeof schema !== "object") {
			return schema;
		}

		const unsupportedFields = new Set([
			"maxItems",
			"minItems",
			"minimum",
			"maximum",
			"exclusiveMin",
			"exclusiveMax",
			"exclusiveMinimum",
			"exclusiveMaximum",
			"minLength",
			"maxLength",
		]);

		const constraintLabels: Record<string, string> = {
			minItems: "minimum number of items: {}",
			maxItems: "maximum number of items: {}",
			minimum: "minimum value: {}",
			maximum: "maximum value: {}",
			exclusiveMin: "exclusive minimum value: {}",
			exclusiveMax: "exclusive maximum value: {}",
			exclusiveMinimum: "exclusive minimum value: {}",
			exclusiveMaximum: "exclusive maximum value: {}",
			minLength: "minimum length: {}",
			maxLength: "maximum length: {}",
		};

		const constraintDescriptions: string[] = [];
		for (const field of unsupportedFields) {
			if (schema[field] !== undefined && constraintLabels[field]) {
				constraintDescriptions.push(constraintLabels[field].replace("{}", String(schema[field])));
			}
		}

		const result: Record<string, unknown> = {};
		if (constraintDescriptions.length > 0) {
			const existingDesc = schema.description as string | undefined;
			const constraintNote = "Note: " + constraintDescriptions.join(", ") + ".";
			result.description = existingDesc ? existingDesc + " " + constraintNote : constraintNote;
		}

		for (const [key, value] of Object.entries(schema)) {
			if (unsupportedFields.has(key)) {
				continue;
			}
			if (key === "description" && result.description !== undefined) {
				continue;
			}

			if (key === "properties" && typeof value === "object" && value !== null) {
				const filteredProps: Record<string, unknown> = {};
				for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
					filteredProps[propKey] =
						typeof propVal === "object" && propVal !== null
							? this._filterAnthropicOutputSchema(propVal as Record<string, unknown>)
							: propVal;
				}
				result[key] = filteredProps;
			} else if (key === "items" && typeof value === "object" && value !== null) {
				result[key] = this._filterAnthropicOutputSchema(value as Record<string, unknown>);
			} else if ((key === "$defs" || key === "definitions") && typeof value === "object" && value !== null) {
				const filteredDefs: Record<string, unknown> = {};
				for (const [defKey, defVal] of Object.entries(value as Record<string, unknown>)) {
					filteredDefs[defKey] =
						typeof defVal === "object" && defVal !== null
							? this._filterAnthropicOutputSchema(defVal as Record<string, unknown>)
							: defVal;
				}
				result[key] = filteredDefs;
			} else if ((key === "anyOf" || key === "allOf" || key === "oneOf") && Array.isArray(value)) {
				result[key] = value.map((item: unknown) => {
					return typeof item === "object" && item !== null
						? this._filterAnthropicOutputSchema(item as Record<string, unknown>)
						: item;
				});
			} else {
				result[key] = value;
			}
		}

		if (result.type === "object" && !("additionalProperties" in result)) {
			result.additionalProperties = false;
		}

		return result;
	}

	// PY: lighter schema filter for tool input_schema — strips unsupported constraint fields
	// without adding additionalProperties (transformation.py:419-425)
	private _filterToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
		if (!schema || typeof schema !== "object") {
			return schema;
		}
		const unsupportedToolFields = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength"]);
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(schema)) {
			if (unsupportedToolFields.has(key)) {
				continue;
			}
			if (key === "properties" && typeof value === "object" && value !== null) {
				const filteredProps: Record<string, unknown> = {};
				for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
					filteredProps[propKey] =
						typeof propVal === "object" && propVal !== null
							? this._filterToolInputSchema(propVal as Record<string, unknown>)
							: propVal;
				}
				result[key] = filteredProps;
			} else if (key === "items" && typeof value === "object" && value !== null) {
				result[key] = this._filterToolInputSchema(value as Record<string, unknown>);
			} else if ((key === "anyOf" || key === "allOf" || key === "oneOf") && Array.isArray(value)) {
				result[key] = value.map((item: unknown): unknown => {
					return typeof item === "object" && item !== null ? this._filterToolInputSchema(item as Record<string, unknown>) : item;
				});
			} else {
				result[key] = value;
			}
		}
		return result;
	}
	// ========== Context management mapping ==========

	private _mapOpenAIContextManagementToAnthropic(contextManagement: unknown): Record<string, unknown> | null {
		if (typeof contextManagement === "object" && contextManagement !== null) {
			const cm = contextManagement as Record<string, unknown>;
			if (cm.edits && Array.isArray(cm.edits)) {
				return cm;
			}
		}
		if (Array.isArray(contextManagement)) {
			const anthropicEdits: Record<string, unknown>[] = [];
			for (const entry of contextManagement) {
				if (!entry || typeof entry !== "object") {
					continue;
				}
				const e = entry as Record<string, unknown>;
				if (e.type === "compaction") {
					const edit: Record<string, unknown> = { type: "compact_20260112" };
					const compactThreshold = e.compact_threshold;
					if (compactThreshold !== undefined && typeof compactThreshold === "number") {
						edit.trigger = { type: "input_tokens", value: Math.round(compactThreshold) };
					}
					for (const k of Object.keys(e)) {
						if (k !== "type" && k !== "compact_threshold") {
							edit[k] = e[k];
						}
					}
					anthropicEdits.push(edit);
				}
			}
			if (anthropicEdits.length > 0) {
				return { edits: anthropicEdits };
			}
		}
		return null;
	}

	// ========== System message translation ==========

	private _translateSystemMessages(messages: Message[]): AnthropicSystemMessageContent[] {
		const result: AnthropicSystemMessageContent[] = [];
		const toRemove: number[] = [];
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]!;
			if (msg.role !== "system") {
				continue;
			}
			toRemove.push(i);
			const storedCacheControl = (msg as unknown as Record<string, unknown>).cache_control as Record<string, unknown> | undefined;
			if (typeof msg.content === "string") {
				if (!msg.content) {
					continue;
				}
				if (msg.content.startsWith("x-anthropic-billing-header:")) {
					continue;
				}
				const entry: AnthropicSystemMessageContent = { type: "text", text: msg.content };
				if (storedCacheControl) {
					entry.cache_control = storedCacheControl;
				}
				result.push(entry);
			} else if (Array.isArray(msg.content)) {
				for (const sub of msg.content as Array<Record<string, unknown>>) {
					const textValue = sub.text as string | undefined;
					if (sub.type === "text" && !textValue) {
						continue;
					}
					if (sub.type === "text" && textValue && textValue.startsWith("x-anthropic-billing-header:")) {
						continue;
					}
					const entry: AnthropicSystemMessageContent = { type: (sub.type as string) ?? "text", text: textValue ?? "" };
					if (sub.cache_control) {
						entry.cache_control = sub.cache_control as Record<string, unknown>;
					}
					result.push(entry);
				}
			}
		}
		for (let i = toRemove.length - 1; i >= 0; i--) {
			messages.splice(toRemove[i]!, 1);
		}
		return result;
	}

	// ========== reasoning_effort ==========

	private _mapReasoningEffort(reasoningEffort: string | undefined | null, model: string): AnthropicThinkingParam | undefined {
		if (reasoningEffort == null || reasoningEffort === "none") {
			return undefined;
		}
		if (this._isClaude46Model(model)) {
			return { type: "adaptive" };
		}
		switch (reasoningEffort) {
			case "low":
				return { type: "enabled", budget_tokens: DEFAULT_REASONING_EFFORT_LOW_THINKING_BUDGET };
			case "medium":
				return { type: "enabled", budget_tokens: DEFAULT_REASONING_EFFORT_MEDIUM_THINKING_BUDGET };
			case "high":
				return { type: "enabled", budget_tokens: DEFAULT_REASONING_EFFORT_HIGH_THINKING_BUDGET };
			case "minimal":
				return { type: "enabled", budget_tokens: DEFAULT_REASONING_EFFORT_MINIMAL_THINKING_BUDGET };
			default:
				return { type: "enabled", budget_tokens: DEFAULT_REASONING_EFFORT_MEDIUM_THINKING_BUDGET };
		}
	}

	private _isClaude46Model(model: string): boolean {
		const lower = model.toLowerCase();
		return (
			lower.includes("opus-4-6") ||
			lower.includes("opus_4_6") ||
			lower.includes("opus-4.6") ||
			lower.includes("opus_4.6") ||
			lower.includes("sonnet-4-6") ||
			lower.includes("sonnet_4_6") ||
			lower.includes("sonnet-4.6") ||
			lower.includes("sonnet_4.6")
		);
	}

	// ========== user_id normalization ==========

	private _normalizeUserId(user: unknown): string | undefined {
		if (typeof user !== "string") {
			return undefined;
		}

		const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
		if (emailPattern.test(user)) {
			return undefined;
		}

		const phonePattern = /^\+?[\d\s()-]{7,}$/;
		if (phonePattern.test(user)) {
			return undefined;
		}

		const anthropicPattern = /^[a-zA-Z0-9_-]+$/;

		if (user.startsWith("{")) {
			try {
				const parsed = JSON.parse(user) as Record<string, unknown>;
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					const deviceId = (parsed.device_id as string) ?? "";
					const accountUuid = (parsed.account_uuid as string) ?? "";
					const sessionId = (parsed.session_id as string) ?? "";
					if (deviceId || accountUuid || sessionId) {
						const reconstructed = `user_${deviceId}_account_${accountUuid}_session_${sessionId}`;
						if (anthropicPattern.test(reconstructed)) {
							return reconstructed;
						}
					}
					if (typeof parsed.user_id === "string" && anthropicPattern.test(parsed.user_id)) {
						return parsed.user_id;
					}
				}
			} catch {
				/* not JSON */
			}
			return undefined;
		}

		if (anthropicPattern.test(user)) {
			return user;
		}
		return undefined;
	}

	// ========== Stop sequences ==========

	private _mapStopSequences(stop: unknown, dropParams = false): string[] | undefined {
		if (typeof stop === "string") {
			if (stop.trim() === "") {
				return undefined;
			}
			return [stop];
		}
		if (Array.isArray(stop)) {
			const filtered = dropParams
				? stop.filter((v) => typeof v === "string" && v.trim() !== "")
				: stop.filter((v) => typeof v === "string");
			return filtered.length > 0 ? filtered : undefined;
		}
		return undefined;
	}

	// ========== Response extraction ==========

	/**
	 * PY: prefix_prompt support - prepend prefix content to text (transformation.py:1813-1818)
	 * @param blocks
	 */
	private _extractTextWithPrefix(blocks: AnthropicContentBlock[]): string | null {
		const prefixBlocks = blocks.filter((b) => b.type === "text" && (b as unknown as Record<string, unknown>).prefix === true);
		const prefixText = prefixBlocks.map((b) => b.text ?? "").join("");
		const remainingText = this._extractText(blocks);
		const combined = prefixText + (remainingText ?? "");
		return combined.length > 0 ? combined : null;
	}

	private _extractText(blocks: AnthropicContentBlock[]): string | null {
		const texts = blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("");
		return texts.length > 0 ? texts : null;
	}

	// PY: extract container content blocks (transformation.py:1691-1729)
	/**
	 * PY: extract compaction blocks (transformation.py:1543-1546,1776-1777)
	 * @param blocks
	 */
	private _extractCompactionBlocks(blocks: AnthropicContentBlock[]): Record<string, unknown>[] {
		return blocks.filter((b) => b.type === "compaction") as unknown as Record<string, unknown>[];
	}

	/**
	 * PY: extract container content blocks (transformation.py:1691-1729)
	 * @param blocks
	 */
	private _extractContainerContent(blocks: AnthropicContentBlock[]): Record<string, unknown>[] {
		return blocks.filter((b) => b.type === "container" || b.type === "container_upload").map((b) => ({ id: b.id ?? "", type: b.type }));
	}

	/**
	 * PY: Build code_interpreter_results for streaming (handler.py:695-726, 868-876)
	 * @param state
	 */
	private _buildCodeInterpreterResultsForStream(state: StreamState): Record<string, unknown>[] {
		const results: Record<string, unknown>[] = [];
		for (const tr of state.toolResults) {
			if ((tr.type as string) !== "bash_code_execution_tool_result") {
				continue;
			}
			const callId = (tr.tool_use_id as string) ?? "";
			const contentBlock = tr.content as Record<string, unknown> | undefined;
			const toolInput = state.serverToolInputs[callId] ?? {};
			const code = typeof toolInput === "object" ? ((toolInput.command as string) ?? "") : "";
			const logOutputs = this._buildCodeInterpreterLogOutputs(contentBlock ?? {});
			results.push({
				type: "code_interpreter_call",
				id: callId,
				code: code,
				container_id: state.containerId,
				status: "completed",
				outputs: logOutputs,
			});
		}
		return results;
	}

	/**
	 * Build code interpreter log outputs from tool result content (PY: responses/main.py:70+)
	 * @param content
	 */
	private _buildCodeInterpreterLogOutputs(content: Record<string, unknown>): Record<string, unknown>[] {
		const outputs: Record<string, unknown>[] = [];
		const contentList = Array.isArray(content.content) ? content.content : [];
		for (const c of contentList as Record<string, unknown>[]) {
			const cType = c.type as string;
			if (cType === "tool_use") {
				const innerBlocks = Array.isArray(c.content) ? c.content : [];
				for (const inner of innerBlocks as Record<string, unknown>[]) {
					if (inner.type === "tool_result") {
						const textContent = typeof inner.content === "string" ? inner.content : "";
						if (textContent) {
							outputs.push({ type: "text", text: textContent });
						}
					}
				}
			} else if (cType === "text" || cType === "image") {
				const textContent = typeof c.text === "string" ? c.text : "";
				if (textContent || c.source) {
					outputs.push({ type: cType, text: textContent, ...(c.source ? { source: c.source } : {}) });
				}
			}
		}
		return outputs.length > 0 ? outputs : [{ type: "text", text: "" }];
	}

	// PY: extract code_interpreter_results (transformation.py:1764-1770)
	private _extractCodeInterpreterResults(blocks: AnthropicContentBlock[]): Record<string, unknown>[] {
		return blocks.filter((b) => b.type === "code_interpreter_results").map((b) => ({ ...b, type: "code_interpreter_results" }));
	}

	private _extractToolCalls(blocks: AnthropicContentBlock[]): Array<{
		id: string;

		type: "function";

		function: {
			name: string;
			arguments: string;
		};
	}> {
		return blocks
			.filter((b) => b.type === "tool_use" || b.type === "server_tool_use")
			.map((b) => ({
				id: b.id ?? "",
				type: "function" as const,
				function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
			}));
	}

	private _extractThinkingBlocks(blocks: AnthropicContentBlock[]): Array<{
		type: "thinking" | "redacted_thinking";

		thinking: string;

		signature: string;
	}> {
		return blocks
			.filter((b) => b.type === "thinking" || b.type === "redacted_thinking")
			.map((b) => ({
				type: b.type as "thinking" | "redacted_thinking",
				thinking: b.thinking ?? "",
				signature: b.signature ?? "",
			}));
	}

	private _extractCitations(blocks: AnthropicContentBlock[]): Array<Record<string, unknown>> {
		const citations: Array<Record<string, unknown>> = [];
		for (const block of blocks) {
			if (block.citations && Array.isArray(block.citations)) {
				for (const citation of block.citations) {
					citations.push({ ...citation, supported_text: block.text ?? "" });
				}
			}
		}
		return citations;
	}

	private _extractUsage(raw: Record<string, unknown>): {
		prompt_tokens: number;

		completion_tokens: number;

		total_tokens: number;

		cache_creation_input_tokens: number;

		cache_read_input_tokens: number;

		completion_tokens_details?: TokenDetails;

		prompt_tokens_details?: PromptTokenDetails;

		// PY: server_tool_use info (transformation.py:1596-1625,1676-1684)
		web_search_requests: number;
		tool_search_requests: number;
		inference_geo?: string;
		speed?: string;

		// PY: cache_creation_token_details — ephemeral durations (transformation.py:1639-1647)
		cache_creation_token_details?: Record<string, number>;
	} {
		const u = raw.usage as Record<string, number> | undefined;
		if (!u) {
			return {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				web_search_requests: 0,
				tool_search_requests: 0,
			};
		}
		const inputTokens = u.input_tokens ?? 0;
		const outputTokens = u.output_tokens ?? 0;
		const cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;
		const cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
		const promptTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
		const completionTokens = outputTokens;
		const totalTokens = promptTokens + completionTokens;

		const contentBlocks = raw.content as AnthropicContentBlock[] | undefined;
		let reasoningContent: string | undefined;
		if (contentBlocks) {
			const texts = contentBlocks.filter((b) => b.type === "thinking" || b.type === "redacted_thinking").map((b) => b.thinking ?? "");
			if (texts.length > 0) {
				reasoningContent = texts.join("");
			}
		}
		const reasoningTokens = reasoningContent ? Math.max(1, Math.ceil(reasoningContent.length / 4)) : 0;
		const textTokens = reasoningTokens > 0 ? completionTokens - reasoningTokens : completionTokens;

		// PY: Extract server_tool_use info (transformation.py:1596-1625)
		const webSearchRequests = (u as Record<string, number>)["web_search_requests"] ?? 0;
		const toolSearchRequests = (u as Record<string, number>)["tool_search_requests"] ?? 0;

		// PY: Extract inference_geo and speed (transformation.py:1676-1684)
		const inferenceGeo = raw.inference_geo as string | undefined;
		const speed = raw.speed as string | undefined;

		// PY: Extract cache_creation_token_details (transformation.py:1639-1647)
		let cacheCreationTokenDetails: Record<string, number> | undefined;
		const cacheCreation = (raw.usage as Record<string, unknown>)?.cache_creation as Record<string, number> | undefined;
		if (cacheCreation) {
			cacheCreationTokenDetails = {};
			if (cacheCreation["ephemeral_5m_input_tokens"] !== undefined) {
				cacheCreationTokenDetails["ephemeral_5m_input_tokens"] = cacheCreation["ephemeral_5m_input_tokens"];
			}
			if (cacheCreation["ephemeral_1h_input_tokens"] !== undefined) {
				cacheCreationTokenDetails["ephemeral_1h_input_tokens"] = cacheCreation["ephemeral_1h_input_tokens"];
			}
		}

		return {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
			cache_creation_input_tokens: cacheCreationInputTokens,
			cache_read_input_tokens: cacheReadInputTokens,
			completion_tokens_details: {
				reasoning_tokens: reasoningTokens > 0 ? reasoningTokens : 0,
				text_tokens: textTokens > 0 ? textTokens : completionTokens,
			},
			prompt_tokens_details: {
				cached_tokens: cacheReadInputTokens || undefined,
				cache_creation_tokens: cacheCreationInputTokens || undefined,
			},
			web_search_requests: webSearchRequests,
			tool_search_requests: toolSearchRequests,
			inference_geo: inferenceGeo,
			speed: speed,
			cache_creation_token_details: cacheCreationTokenDetails,
		};
	}

	private _convertToolResponseToMessage(
		toolCalls: Array<{
			id: string;
			type: "function";
			function: {
				name: string;

				arguments: string;
			};
		}>,
	): string | null {
		if (toolCalls.length !== 1) {
			return null;
		}
		const argsStr = toolCalls[0]!.function.arguments;
		try {
			const args = JSON.parse(argsStr) as Record<string, unknown>;
			return args.values !== undefined ? JSON.stringify(args.values) : JSON.stringify(args);
		} catch {
			return argsStr;
		}
	}

	/**
	 * PY: Convert Anthropic rate limit headers to OpenAI format (common_utils.py:642-666).
	 * @param response - Anthropic response with rate limit headers
	 */
	static convertRateLimitHeaders(response: Record<string, string>): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const headers = response as Record<string, string>;
		// Anthropic headers: request-id, anthropic-ratelimit-requests-limit,
		// anthropic-ratelimit-requests-remaining, anthropic-ratelimit-tokens-limit,
		// anthropic-ratelimit-tokens-remaining, anthropic-ratelimit-tokens-reset
		const mapping: Record<string, string> = {
			"x-ratelimit-limit-requests": "anthropic-ratelimit-requests-limit",
			"x-ratelimit-limit-tokens": "anthropic-ratelimit-tokens-limit",
			"x-ratelimit-remaining-requests": "anthropic-ratelimit-requests-remaining",
			"x-ratelimit-remaining-tokens": "anthropic-ratelimit-tokens-remaining",
			"x-ratelimit-reset-requests": "anthropic-ratelimit-requests-reset",
			"x-ratelimit-reset-tokens": "anthropic-ratelimit-tokens-reset",
		};
		for (const [openaiKey, anthropicKey] of Object.entries(mapping)) {
			const rawKey = anthropicKey.toLowerCase();
			const matchingKey = Object.keys(headers).find((k) => k.toLowerCase() === rawKey);
			if (matchingKey) {
				result[openaiKey] = headers[matchingKey];
			}
		}
		return result;
	}
}

/**
 * Anthropic API 调用错误
 *
 * 包含错误类型标识，用于区分不同的 API 错误场景。
 */
export class AnthropicError extends Error {
	readonly type: string;

	constructor(message: string, type = "unknown") {
		super(message);
		this.name = "AnthropicError";
		this.type = type;
	}
}
