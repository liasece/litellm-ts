import type { LogEntry } from "../../src/features/logs/support/LogsModels";
export const messages = [
	{ role: "system", content: "Keep the result concise." },
	{ role: "user", content: "Earlier request" },
	{ role: "assistant", content: "Earlier response" },
	{ role: "user", content: "Current request" },
];
export const first: LogEntry = {
	request_id: "log-one",
	model: "openai/gpt-fixture",
	custom_llm_provider: "openai",
	call_type: "acompletion",
	model_id: "fixture-deployment",
	api_base: "https://example.test/v1",
	spend: 0.003,
	prompt_tokens: 100,
	completion_tokens: 40,
	total_tokens: 140,
	startTime: "2026-11-07T02:00:00Z",
	endTime: "2026-11-07T02:00:02Z",
	request_duration_ms: 2000,
	messages,
	response: {
		choices: [
			{
				message: {
					role: "assistant",
					content:
						"Answer with **detail**\n\n![Generated](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9N8AAAAASUVORK5CYII=)",
				},
			},
		],
	},
	proxy_server_request: {
		url: "/v1/chat/completions",
		body: {
			model: "gpt-fixture",
			messages,
			tools: [
				{
					type: "function",
					function: {
						name: "lookup",
						description: "Look up a fixture",
						parameters: { type: "object", properties: { query: { type: "string" } } },
					},
				},
			],
			temperature: 0.5,
			stream: true,
		},
		upstream_request: {
			url: "https://example.test/v1/responses",
			body: {
				model: "provider-fixture",
				input: messages,
				tools: [
					{
						type: "function",
						name: "lookup",
						description: "Look up a fixture",
						parameters: { type: "object", properties: { query: { type: "string" } } },
					},
				],
				reasoning: { effort: "high" },
			},
		},
		upstream_response: {
			status_code: 200,
			body: { output: [{ type: "message", content: [{ type: "output_text", text: "Answer with detail" }] }] },
		},
	},
	metadata: {
		status: "success",
		user_api_key_team_alias: "Fixture team",
		cost_breakdown: {
			input_cost: 0.001,
			output_cost: 0.002,
			total_cost: 0.003,
			original_cost: 0.004,
			discount_percent: 0.25,
			discount_amount: 0.001,
		},
		model_resolution_chain: [
			{
				fallback_index: 0,
				input_model: "public-fixture",
				resolved_model: "gpt-fixture",
				resolution_path: ["public-fixture", "gpt-fixture"],
			},
		],
		vector_store_request_metadata: [
			{
				query: "fixture search",
				start_time: 1794016800,
				end_time: 1794016800.1,
				vector_store_id: "vector-fixture",
				custom_llm_provider: "openai",
				vector_store_search_response: { data: [{ score: 0.95, content: [{ type: "text", text: "Retrieved fixture text" }] }] },
			},
		],
		guardrail_information: [
			{
				guardrail_name: "PII fixture",
				guardrail_provider: "presidio",
				guardrail_status: "success",
				guardrail_mode: ["pre_call", "post_call"],
				start_time: 1,
				end_time: 1.02,
				duration: 0.02,
				masked_entity_count: { EMAIL_ADDRESS: 1 },
				patterns_checked: 10,
				guardrail_response: [
					{
						entity_type: "EMAIL_ADDRESS",
						score: 0.95,
						start: 0,
						end: 10,
						recognition_metadata: { recognizer_name: "Fixture recognizer", recognizer_identifier: "fixture-id" },
						analysis_explanation: "Fixture match",
					},
				],
			},
			{
				guardrail_name: "Bedrock fixture",
				guardrail_provider: "bedrock",
				guardrail_status: "success",
				guardrail_mode: "post_call",
				start_time: 1.1,
				end_time: 1.2,
				duration: 0.1,
				guardrail_response: {
					action: "NONE",
					assessments: [
						{
							contentPolicy: {
								filters: [{ type: "HATE", action: "NONE", detected: false, filterStrength: "HIGH", confidence: "LOW" }],
							},
							sensitiveInformationPolicy: {
								regexes: [{ name: "Fixture regex", regex: "[0-9]+", detected: false, action: "NONE" }],
							},
						},
					],
				},
			},
			{
				guardrail_name: "Filter fixture",
				guardrail_provider: "litellm_content_filter",
				guardrail_status: "success",
				guardrail_mode: "pre_call",
				start_time: 1,
				end_time: 1.01,
				duration: 0.01,
				guardrail_response: [{ type: "pattern", pattern_name: "Fixture pattern", action: "MASK" }],
			},
		],
	},
};
export const second: LogEntry = {
	...first,
	request_id: "log-two",
	model: "anthropic/claude-fixture",
	custom_llm_provider: "anthropic",
	metadata: { status: "success" },
	messages: [{ role: "user", content: "Second prompt" }],
	proxy_server_request: { body: { messages: [{ role: "user", content: "Second prompt" }] } },
	response: { choices: [{ message: { role: "assistant", content: "Second answer" } }] },
};
export const group = { type: "session_id" as const, id: "session-fixture" };
export const event = (id: string, role: "user" | "assistant" | "tool", content: string, parts?: unknown[]) => ({
	id,
	request_id: "log-one",
	role,
	label: role === "user" ? "用户" : role === "tool" ? "工具" : "助手",
	timestamp: "2026-11-07T02:00:00Z",
	model: "fixture",
	content,
	...(parts ? { parts } : {}),
});
export const timeline = {
	data: [
		event("user", "user", "<system-reminder>Remember the fixture</system-reminder>Current prompt"),
		event("tool", "tool", "Fixture command output", [
			{ kind: "tool_result", label: "Tool result", id: "tool-call", name: "Bash", text: "Fixture command output" },
		]),
		event("assistant", "assistant", "Final answer", [{ kind: "text", label: "Text", text: "Final answer" }]),
	],
	summary: {
		keys: [{ alias: "Fixture Key", hash: "fixture-key-hash" }],
		request_count: 2,
		event_count: 3,
		total_spend: 0.003,
		total_tokens: 140,
		duration_seconds: 2,
		start_time: "2026-11-07T02:00:00Z",
		end_time: "2026-11-07T02:00:02Z",
	},
	active_requests: [],
	window: { returned_requests: 2, total_requests: 3, has_more: true, before: "earlier-page", limit: 2 },
};
