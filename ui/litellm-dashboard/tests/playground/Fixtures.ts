export const fixtureNow = "2026-11-07T02:00:00.000Z";
export const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=";
export const models = [
	{ model_name: "fixture-chat", mode: "chat", type: "alias" },
	{ model_name: "fixture-second", mode: "chat", type: "model" },
	{ model_name: "fixture-image", mode: "image_generation", type: "model" },
	{ model_name: "fixture-embedding", mode: "embedding", type: "model" },
	{ model_name: "fixture-speech", mode: "audio_speech", type: "model" },
	{ model_name: "fixture-transcription", mode: "audio_transcription", type: "model" },
];
export const servers = [
	{
		server_id: "mcp-fixture",
		server_name: "fixture-tools",
		alias: "Fixture Tools",
		description: "Synthetic tools for migration verification",
		auth_type: "none",
		transport: "http",
	},
	{
		server_id: "mcp-byok",
		server_name: "byok-tools",
		alias: "BYOK Tools",
		description: "Synthetic key-based connection",
		is_byok: true,
		has_user_credential: false,
		byok_description: ["Read fixture records"],
	},
	{
		server_id: "mcp-oauth",
		server_name: "oauth-tools",
		alias: "OAuth Tools",
		description: "Synthetic OAuth connection",
		auth_type: "oauth2",
		transport: "sse",
	},
];
export const tools = [
	{
		name: "lookup",
		description: "Look up a fixture record",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Record query" },
				limit: { type: "integer", default: 2 },
				filters: { type: "object", default: { status: "active" } },
			},
			required: ["query"],
		},
	},
];
export const agent = {
	model_name: "fixture-agent",
	litellm_params: {
		model: "litellm_agent/fixture-chat",
		litellm_system_prompt: "You are a fixture assistant.",
		temperature: 0.7,
		max_tokens: 4096,
		tools: [],
	},
	model_info: { id: "agent-fixture-id" },
};
export function fixtureForPlayground(pathname: string, method = "GET", body: Record<string, unknown> = {}): unknown {
	if (method === "OPTIONS") return {};
	if (pathname === "/config/routable_model/options") return models;
	if (pathname === "/model_group/info") return { data: models.map((model) => ({ model_group: model.model_name, mode: model.mode })) };
	if (pathname === "/get/ui_settings" || pathname === "/sso/get/ui_settings")
		return { PROXY_BASE_URL: "https://proxy.example.test", LITELLM_UI_API_DOC_BASE_URL: "" };
	if (pathname === "/v1/mcp/server") return servers;
	if (pathname === "/mcp-rest/tools/list") return { tools, error: null };
	if (pathname === "/mcp-rest/tools/call") return { content: [{ type: "text", text: "Fixture tool result" }] };
	if (pathname === "/v2/guardrails/list" || pathname === "/guardrails/list")
		return { guardrails: [{ guardrail_name: "fixture-guardrail", litellm_params: { guardrail: "litellm_content_filter" } }] };
	if (pathname === "/policies/list")
		return { policies: [{ policy_name: "fixture-policy", production_version: 1, versions: [{ version: 1, status: "published" }] }] };
	if (pathname === "/vector_store/list") return { data: [{ vector_store_id: "vector-fixture", vector_store_name: "Fixture Vector" }] };
	if (pathname === "/tag/list") return { "fixture-tag": { name: "fixture-tag", description: "Fixture tag" } };
	if (pathname === "/v1/agents") return [{ agent_id: "a2a-fixture", agent_name: "fixture-a2a", description: "Fixture A2A agent" }];
	if (pathname === "/v2/model/info") return { data: [agent], total_count: 1 };
	if (pathname === "/model/new" || pathname.endsWith("/update") || pathname === "/model/delete") return { success: true };
	if (pathname === "/key/generate") return { key: "synthetic-created-key" };
	if (pathname === "/v1/mcp/user-credentials")
		return [{ server_id: "mcp-oauth", server_name: "oauth-tools", alias: "OAuth Tools", connected_at: fixtureNow, expires_at: null }];
	if (pathname.endsWith("/oauth-user-credential/status")) return { server_id: "mcp-oauth", has_credential: false, is_expired: false };
	if (pathname.endsWith("/oauth-user-credential") || pathname.endsWith("/user-credential")) return { success: true };
	if (pathname.endsWith("/register")) return { client_id: "synthetic-client" };
	if (pathname.endsWith("/token")) return { access_token: "synthetic-oauth", expires_in: 3600 };
	if (pathname === "/utils/test_policies_and_guardrails") {
		const inputs = body.inputs_list;
		if (Array.isArray(inputs))
			return {
				results: inputs.map((input, index) => ({
					inputs: input,
					guardrail_errors: index % 2 === 0 ? [{ guardrail_name: "fixture-guardrail", message: "Fixture policy violation" }] : [],
				})),
			};
		return { inputs: { texts: ["Fixture processed text"] }, guardrail_errors: [] };
	}
	if (pathname === "/images/generations" || pathname === "/images/edits") return { data: [{ url: png }] };
	if (pathname === "/audio/transcriptions") return { text: "Fixture audio transcription" };
	if (pathname === "/embeddings") return { model: "fixture-embedding", data: [{ embedding: [0.1, 0.2, 0.3] }] };
	if (pathname.startsWith("/a2a/"))
		return {
			jsonrpc: "2.0",
			id: "fixture",
			result: {
				kind: "task",
				id: "task-fixture",
				contextId: "context-fixture",
				status: { state: "completed", timestamp: fixtureNow },
				artifacts: [{ parts: [{ kind: "text", text: "Fixture agent answer" }] }],
			},
		};
	return null;
}
export function sseFrames(frames: unknown[]) {
	return frames.map((frame) => "data: " + JSON.stringify(frame) + "\n\n").join("") + "data: [DONE]\n\n";
}
export function chatStream() {
	return sseFrames([
		{ model: "fixture-chat", choices: [{ delta: { reasoning_content: "Fixture reasoning" } }] },
		{ model: "fixture-chat", choices: [{ delta: { content: "Fixture chat answer" } }] },
		{ usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cost: 0 } },
	]);
}
export function responsesStream(responseId = "response-fixture") {
	return sseFrames([
		{ type: "response.output_text.delta", delta: "Fixture Responses answer" },
		{ type: "response.completed", response: { id: responseId, usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } },
	]);
}
export function anthropicStream() {
	return sseFrames([
		{ type: "message_start", message: { usage: { input_tokens: 3 } } },
		{ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Fixture Anthropic thinking" } },
		{ type: "content_block_delta", delta: { type: "text_delta", text: "Fixture Anthropic answer" } },
		{ type: "message_delta", usage: { output_tokens: 4 } },
	]);
}
