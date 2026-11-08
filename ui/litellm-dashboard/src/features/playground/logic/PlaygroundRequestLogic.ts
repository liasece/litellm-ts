import type { PlaygroundRequest } from "../support/PlaygroundModels";
import { inferenceUrl } from "../api/PlaygroundTransportApi";
export function mcpTools(request: PlaygroundRequest, responses = false): Record<string, unknown>[] {
	if (request.selectedMcpServers.includes("__all__"))
		return [
			{
				type: "mcp",
				server_label: "litellm",
				server_url: responses ? inferenceUrl("/mcp", request.customBaseUrl) : "litellm_proxy/mcp",
				require_approval: "never",
			},
		];
	return request.selectedMcpServers.map((id) => {
		const server = request.mcpServers.find((server) => server.server_id === id),
			routeName = responses ? server?.server_name || id : server?.alias || server?.server_name || id,
			allowed = request.mcpRestrictions[id] ?? [];
		return {
			type: "mcp",
			server_label: responses ? routeName : "litellm",
			server_url: responses
				? inferenceUrl("/mcp/" + encodeURIComponent(routeName), request.customBaseUrl)
				: "litellm_proxy/mcp/" + routeName,
			require_approval: "never",
			...(allowed.length ? { allowed_tools: allowed } : {}),
		};
	});
}
export function requestBody(request: PlaygroundRequest): Record<string, unknown> {
	const common = {
		model: request.model,
		stream: true,
		...(request.traceId ? { litellm_trace_id: request.traceId } : {}),
		...(request.vectorStores.length ? { vector_store_ids: request.vectorStores } : {}),
		...(request.guardrails.length ? { guardrails: request.guardrails } : {}),
		...(request.policies.length ? { policies: request.policies } : {}),
	};
	if (request.endpoint === "anthropic_messages") return { ...common, messages: request.messages, max_tokens: 1024 };
	if (request.endpoint === "responses") {
		const tools = mcpTools(request, true);
		if (request.codeInterpreter) tools.push({ type: "code_interpreter", container: { type: "auto" } });
		return {
			...common,
			input: request.messages.map((message) => ({ ...message, type: "message" })),
			...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
			...(tools.length ? { tools, tool_choice: "auto" } : {}),
		};
	}
	const tools = mcpTools(request);
	return {
		...common,
		messages: request.messages,
		stream_options: { include_usage: true },
		...(tools.length ? { tools, tool_choice: "auto" } : {}),
		...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
		...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
		...(request.mockFallbacks ? { mock_testing_fallbacks: true } : {}),
	};
}
