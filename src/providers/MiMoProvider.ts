/**
 * MiMo Provider (Xiaomi)
 *
 * Uses Anthropic-compatible protocol.
 * Default api_base: https://token-plan-cn.xiaomimimo.com
 * Supports mimo-v2.5-pro, mimo-v2.5
 *
 * Reuses GLMProvider's Anthropic-compatible logic since both use the same protocol shape.
 * Can switch to MiMo-specific endpoint and model handling via a shared base.
 */
import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { Message, ModelResponse, ModelResponseStream } from "../types/openai";
import type { AnthropicContentBlock } from "../types/anthropic";
import { AnthropicProvider } from "./AnthropicProvider";

/**
 * MiMo 提供商（小米）
 *
 * 使用 Anthropic 兼容协议处理 MiMo 系列模型的请求/响应转换。
 */
export class MiMoProvider implements ProviderConfig {
	private _apiBase: string;

	constructor(apiBase = "https://token-plan-cn.xiaomimimo.com") {
		this._apiBase = apiBase;
	}

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const { system, anthropicMessages } = this.toAnthropicMessages(messages);

		const body: Record<string, unknown> = {
			model: model,
			messages: anthropicMessages,
			max_tokens: (optionalParams.max_tokens as number) ?? 4096,
		};

		if (system) {
			body.system = system;
		}

		if (optionalParams.tools) {
			body.tools = optionalParams.tools;
		}

		// tool_choice: map OpenAI format to Anthropic format
		if (optionalParams.tool_choice !== undefined) {
			body.tool_choice = this._mapToolChoice(optionalParams.tool_choice);
		}

		// response_format
		if (optionalParams.response_format) {
			const rf = optionalParams.response_format as Record<string, unknown>;
			if (rf.type === "json_object" || rf.type === "json_schema") {
				const jsonTool = this._createJsonToolCall(rf);
				const existingTools = (body.tools as unknown[]) ?? [];
				body.tools = [...existingTools, jsonTool];
				if (!body.tool_choice) {
					body.tool_choice = { type: "tool", name: (rf.name as string) ?? "json_tool_call" };
				}
				body.json_mode = true;
			}
		}

		for (const key of ["temperature", "top_p", "stop_sequences", "stream"] as const) {
			if (optionalParams[key] !== undefined) {
				body[key] = optionalParams[key];
			}
		}

		// thinking / reasoning_effort
		if (optionalParams.thinking) {
			body.thinking = optionalParams.thinking;
		} else if (optionalParams.reasoning_effort) {
			const budgetMap: Record<string, number> = { low: 1024, medium: 2048, high: 4096, minimal: 128 };
			const effort = optionalParams.reasoning_effort as string;
			body.thinking = { type: "enabled", budget_tokens: budgetMap[effort] ?? 2048 };
		}

		// output_config
		if (optionalParams.output_config) {
			body.output_config = optionalParams.output_config;
		}

		// context_management
		if (optionalParams.context_management) {
			body.context_management = optionalParams.context_management;
		}

		// web_search_options
		if (optionalParams.web_search_options) {
			const wso = optionalParams.web_search_options as Record<string, unknown>;
			body.tools = [...((body.tools as unknown[]) ?? []), { type: "web_search", name: "web_search", ...wso }];
		}

		// speed
		if (optionalParams.speed) {
			body.speed = optionalParams.speed;
		}

		// cache_control
		if (optionalParams.cache_control) {
			body.cache_control = optionalParams.cache_control;
		}

		const apiKey = optionalParams.api_key as string | undefined;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`;
		}

		// anthropic-beta headers pass-through from extra_headers
		if (optionalParams.extra_headers) {
			const extra = optionalParams.extra_headers as Record<string, string>;
			const anthropicBeta = extra["anthropic-beta"];
			if (anthropicBeta) {
				headers["anthropic-beta"] = anthropicBeta;
			}
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
		const id = (raw.id as string) ?? `mimo-${Date.now()}`;
		const respModel = (raw.model as string) ?? model;

		const contentBlocks = (raw.content as AnthropicContentBlock[]) ?? [];
		const content = this.extractText(contentBlocks);
		const toolCalls = this.extractToolCalls(contentBlocks);

		const stopReason = (raw.stop_reason as string) ?? "end_turn";
		const stopReasonMap: Record<string, string> = { end_turn: "stop", tool_use: "tool_calls", max_tokens: "length" };
		const mappedStopReason = stopReasonMap[stopReason] ?? stopReason;

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
						content: content,
						role: "assistant",
						...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
					},
				},
			],
			usage: {
				prompt_tokens: usage?.prompt_tokens ?? this.extractUsage(raw).prompt_tokens ?? 0,
				completion_tokens: usage?.completion_tokens ?? this.extractUsage(raw).completion_tokens ?? 0,
				total_tokens: usage?.total_tokens ?? this.extractUsage(raw).total_tokens ?? 0,
			},
		};
	}

	/**
	 * 获取 MiMo 支持的所有请求参数列表
	 */
	getSupportedParams(): string[] {
		return [
			"max_tokens",
			"temperature",
			"top_p",
			"stop_sequences",
			"stream",
			"tools",
			"tool_choice",
			"response_format",
			"thinking",
			"reasoning_effort",
			"output_config",
			"context_management",
			"web_search_options",
			"speed",
			"cache_control",
			"extra_headers",
			"api_key",
		];
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
		yield* new AnthropicProvider().streamResponse(response);
	}

	/**
	 * 将 OpenAI 的 tool_choice 格式映射到 Anthropic 格式
	 * @param toolChoice
	 */
	private _mapToolChoice(toolChoice: unknown): unknown {
		if (typeof toolChoice === "string") {
			switch (toolChoice) {
				case "auto":
					return { type: "auto" };
				case "required":
					return { type: "any" };
				case "none":
					return { type: "none" };
				default:
					return { type: "tool", name: toolChoice };
			}
		}
		if (typeof toolChoice === "object" && toolChoice !== null) {
			const tc = toolChoice as Record<string, unknown>;
			if (tc.type === "function") {
				const fn = tc.function as Record<string, unknown> | undefined;
				return { type: "tool", name: (fn?.name as string) ?? "unknown" };
			}
			return toolChoice;
		}
		return toolChoice;
	}

	/**
	 * 创建 json_tool_call 工具定义用于 response_format
	 * @param responseFormat
	 */
	private _createJsonToolCall(responseFormat: Record<string, unknown>): Record<string, unknown> {
		const name = (responseFormat.name as string) ?? "json_tool_call";
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

	/**
	 * 将 OpenAI Message 格式转换为 Anthropic 消息格式
	 * @param messages
	 */
	toAnthropicMessages(messages: Message[]): {
		system?: string;
		anthropicMessages: Array<{
			role: string;
			content: unknown;
		}>;
	} {
		let system: string | undefined;
		const anthropicMessages: Array<{
			role: string;
			content: unknown;
		}> = [];

		for (const msg of messages) {
			if (msg.role === "system") {
				system = msg.content ?? "";
				continue;
			}

			if (msg.role === "tool") {
				anthropicMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: (msg as unknown as Record<string, unknown>).tool_call_id as string,
							content: msg.content ?? "",
						},
					],
				});
				continue;
			}

			if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
				const content: AnthropicContentBlock[] = [];
				if (msg.content) {
					content.push({ type: "text", text: msg.content });
				}
				for (const tc of msg.tool_calls) {
					content.push({
						type: "tool_use",
						id: tc.id,
						name: tc.function.name,
						input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
					});
				}
				anthropicMessages.push({ role: "assistant", content: content });
				continue;
			}

			anthropicMessages.push({
				role: msg.role,
				content: [{ type: "text", text: msg.content ?? "" }],
			});
		}

		return { system: system, anthropicMessages: anthropicMessages };
	}

	/**
	 * 从内容块中提取文本
	 * @param blocks
	 */
	extractText(blocks: AnthropicContentBlock[]): string | null {
		const texts = blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("");
		return texts.length > 0 ? texts : null;
	}

	/**
	 * 从内容块中提取工具调用
	 * @param blocks
	 */
	extractToolCalls(blocks: AnthropicContentBlock[]): Array<{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}> {
		return blocks
			.filter((b) => b.type === "tool_use")
			.map((b) => ({
				id: b.id ?? "",
				type: "function" as const,
				function: {
					name: b.name ?? "",
					arguments: JSON.stringify(b.input ?? {}),
				},
			}));
	}

	/**
	 * 从原始响应中提取用量信息
	 * @param raw
	 */
	extractUsage(raw: Record<string, unknown>): {
		prompt_tokens: number;

		completion_tokens: number;

		total_tokens: number;
	} {
		const u = raw.usage as Record<string, number> | undefined;
		if (!u) {
			return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
		}
		const input = u.input_tokens ?? u.prompt_tokens ?? 0;
		const output = u.output_tokens ?? u.completion_tokens ?? 0;
		return {
			prompt_tokens: input,
			completion_tokens: output,
			total_tokens: input + output,
		};
	}
}
