import type { PlaygroundRequest } from "../support/PlaygroundModels";
export function requestBody(request: PlaygroundRequest): Record<string, unknown> {
	const common = {
		model: request.model,
		stream: true,
		...(request.traceId ? { litellm_trace_id: request.traceId } : {}),
	};
	if (request.endpoint === "anthropic_messages") return { ...common, messages: request.messages, max_tokens: 1024 };
	if (request.endpoint === "responses") {
		const tools = request.codeInterpreter ? [{ type: "code_interpreter", container: { type: "auto" } }] : [];
		return {
			...common,
			input: request.messages.map((message) => ({ ...message, type: "message" })),
			...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
			...(tools.length ? { tools, tool_choice: "auto" } : {}),
		};
	}
	return {
		...common,
		messages: request.messages,
		stream_options: { include_usage: true },
		...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
		...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
		...(request.mockFallbacks ? { mock_testing_fallbacks: true } : {}),
	};
}
