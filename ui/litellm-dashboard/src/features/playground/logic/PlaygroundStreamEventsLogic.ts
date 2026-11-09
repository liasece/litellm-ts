import type { PlaygroundCallbacks, PlaygroundUsage } from "../support/PlaygroundModels";
import { asRecord, records, string, number } from "./PlaygroundValueLogic";
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
export function applyChatChunk(chunk: Record<string, unknown>, callbacks: PlaygroundCallbacks): boolean {
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
	if (chunk.usage) callbacks.usage?.(usageValues(chunk.usage));
	return meaningful;
}
export interface ResponsesStreamState {
	interpreter: InterpreterState;
}
export const emptyResponsesStream = (): ResponsesStreamState => ({ interpreter: { code: "", containerId: "" } });
export function applyResponsesEvent(
	event: Record<string, unknown>,
	model: string,
	callbacks: PlaygroundCallbacks,
	state: ResponsesStreamState,
): boolean {
	const type = string(event.type) ?? "";
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
		if (response?.usage) callbacks.usage?.(usageValues(response.usage, false));
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
