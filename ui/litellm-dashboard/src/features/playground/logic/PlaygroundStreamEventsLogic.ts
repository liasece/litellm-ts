import type { PlaygroundCallbacks, PlaygroundEvent, PlaygroundUsage } from "../support/PlaygroundModels";
import { asRecord, records, string, number, json } from "./PlaygroundValueLogic";
import { processCodeInterpreter, type InterpreterState } from "./PlaygroundCodeInterpreterLogic";
export function usageValues(value: unknown, openAI = true): PlaygroundUsage {
	const record = asRecord(value) ?? {},
		prompt = number(record[openAI ? "prompt_tokens" : "input_tokens"]),
		completion = number(record[openAI ? "completion_tokens" : "output_tokens"]);
	const cost = typeof record.cost === "string" ? Number(record.cost) : number(record.cost);
	return {
		promptTokens: prompt,
		completionTokens: completion,
		totalTokens: number(record.total_tokens) ?? (prompt !== undefined && completion !== undefined ? prompt + completion : undefined),
		reasoningTokens:
			number(asRecord(record.completion_tokens_details)?.reasoning_tokens) ??
			number(asRecord(record.output_tokens_details)?.reasoning_tokens),
		...(cost !== undefined && Number.isFinite(cost) ? { cost } : {}),
	};
}
export interface ChatStreamState {
	listToolsProcessed: boolean;
	toolCalls: Record<string, unknown>[];
	results: Record<string, unknown>[];
}
export const emptyChatStream = (): ChatStreamState => ({ listToolsProcessed: false, toolCalls: [], results: [] });
export function applyChatChunk(chunk: Record<string, unknown>, callbacks: PlaygroundCallbacks, state: ChatStreamState): boolean {
	// The reference surfaces a chunk without choices as an exception and the chat/compare
	// callers render it verbatim, so index the array exactly as the reference does.
	const first = (chunk.choices as Record<string, unknown>[])[0],
		delta = asRecord(first?.delta),
		model = string(chunk.model);
	let meaningful = false;
	if (typeof delta?.content === "string" && delta.content) {
		callbacks.text(delta.content, model);
		meaningful = true;
	}
	if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
		callbacks.reasoning?.(delta.reasoning_content);
		meaningful = true;
	}
	const image = asRecord(delta?.image);
	if (typeof image?.url === "string") callbacks.image?.(image.url, model);
	const fields = asRecord(delta?.provider_specific_fields);
	if (Array.isArray(fields?.search_results)) callbacks.search?.(records(fields.search_results));
	if (fields) {
		if (Array.isArray(fields.mcp_list_tools) && !state.listToolsProcessed) {
			state.listToolsProcessed = true;
			callbacks.mcp?.({
				type: "response.output_item.done",
				timestamp: Date.now(),
				item_id: "mcp_list_tools",
				item: {
					type: "mcp_list_tools",
					tools: records(fields.mcp_list_tools).map((tool) => {
						const fn = asRecord(tool.function);
						return {
							name: string(fn?.name) ?? string(tool.name) ?? "",
							description: string(fn?.description) ?? string(tool.description) ?? "",
							input_schema: fn?.parameters ?? tool.input_schema ?? {},
						};
					}),
				},
			});
		}
		if (Array.isArray(fields.mcp_tool_calls)) state.toolCalls = records(fields.mcp_tool_calls);
		if (Array.isArray(fields.mcp_call_results)) state.results = records(fields.mcp_call_results);
	}
	if (chunk.usage) callbacks.usage?.(usageValues(chunk.usage));
	return meaningful;
}
export function finishChatStream(state: ChatStreamState, callbacks: PlaygroundCallbacks) {
	state.toolCalls.forEach((tool, index) => {
		const fn = asRecord(tool.function),
			id = tool.id ?? tool.call_id,
			args = fn?.arguments ?? tool.arguments ?? "{}",
			result = state.results.find((result) => result.tool_call_id === id) ?? state.results[index],
			output = result?.result;
		callbacks.mcp?.({
			type: "response.output_item.done",
			timestamp: Date.now(),
			item_id: string(id),
			item: {
				type: "mcp_call",
				name: string(fn?.name) ?? string(tool.name) ?? "",
				arguments: typeof args === "string" ? args : json(args),
				...(output ? { output: typeof output === "string" ? output : json(output) } : {}),
			},
		});
	});
}
export interface ResponsesStreamState {
	interpreter: InterpreterState;
	toolName: string;
}
export const emptyResponsesStream = (): ResponsesStreamState => ({ interpreter: { code: "", containerId: "" }, toolName: "" });
export function applyResponsesEvent(
	event: Record<string, unknown>,
	model: string,
	callbacks: PlaygroundCallbacks,
	state: ResponsesStreamState,
): boolean {
	const type = string(event.type) ?? "",
		item = asRecord(event.item);
	if (
		type.startsWith("response.mcp_") ||
		(type === "response.output_item.done" && ["mcp_list_tools", "mcp_call"].includes(String(item?.type)))
	) {
		const mcp: PlaygroundEvent = {
			...event,
			type,
			timestamp: Date.now(),
			item_id: string(event.item_id) ?? string(item?.id),
			...(item ? { item } : {}),
		};
		callbacks.mcp?.(mcp);
	}
	if (type === "response.output_item.done" && item?.type === "mcp_call" && typeof item.name === "string") state.toolName = item.name;
	state.interpreter = processCodeInterpreter(event, state.interpreter, callbacks.code);
	if (type === "response.output_text.delta" && typeof event.delta === "string" && event.delta) {
		callbacks.text(event.delta, model, "assistant");
		return true;
	}
	if (["response.reasoning.delta", "response.reasoning_summary_text.delta"].includes(type) && typeof event.delta === "string")
		callbacks.reasoning?.(event.delta);
	if (type === "response.completed") {
		const response = asRecord(event.response);
		if (typeof response?.id === "string") callbacks.responseId?.(response.id);
		if (response?.usage) callbacks.usage?.(usageValues(response.usage, false), state.toolName);
	}
	if (type === "error" || type === "response.failed") {
		const error = asRecord(event.error) ?? asRecord(asRecord(event.response)?.error);
		throw new Error(string(error?.message) ?? "The model request failed");
	}
	return false;
}
export function applyAnthropicEvent(
	event: Record<string, unknown>,
	model: string,
	callbacks: PlaygroundCallbacks,
	state: { inputTokens?: number },
): boolean {
	if (event.type === "message_start") {
		state.inputTokens = number(asRecord(asRecord(event.message)?.usage)?.input_tokens);
	}
	if (event.type === "content_block_delta") {
		const delta = asRecord(event.delta);
		if (delta?.type === "text_delta" && typeof delta.text === "string") callbacks.text(delta.text, model, "assistant");
		else if (["reasoning_delta", "thinking_delta"].includes(String(delta?.type))) {
			const text = string(delta?.text) ?? string(delta?.thinking);
			if (text) callbacks.reasoning?.(text);
		}
		return true;
	}
	if (event.type === "message_delta" && event.usage) {
		const usage = asRecord(event.usage) ?? {};
		callbacks.usage?.(usageValues({ ...usage, input_tokens: usage.input_tokens ?? state.inputTokens }, false));
	}
	if (event.type === "error") throw new Error(string(asRecord(event.error)?.message) ?? "The model request failed");
	return false;
}
