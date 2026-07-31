import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PrettyMessagesView } from "./PrettyMessagesView";
import { parseMessages } from "./prettyMessagesUtils";

vi.mock("antd", async () => {
	const actual = await vi.importActual<typeof import("antd")>("antd");
	return {
		...actual,
		message: {
			success: vi.fn(),
		},
	};
});

describe("PrettyMessagesView", () => {
	it("should render the component for standard chat completions", () => {
		const request = {
			messages: [{ role: "user", content: "Hello" }],
		};
		const response = {
			choices: [{ message: { role: "assistant", content: "Hi there!" } }],
		};

		render(<PrettyMessagesView request={request} response={response} />);
		expect(screen.getByText("Hello")).toBeInTheDocument();
		expect(screen.getByText("Hi there!")).toBeInTheDocument();
	});

	it("should parse and render Images API base64 output", () => {
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		const response = {
			data: [{ b64_json: "iVBORw0KGgoAAA", revised_prompt: "A World Cup themed poster" }],
			output_format: "png",
		};

		const parsed = parseMessages("Draw a World Cup poster", response);
		expect(parsed.requestMessages).toMatchObject([{ role: "user", content: "Draw a World Cup poster" }]);
		expect(parsed.responseMessage?.parts).toEqual([
			expect.objectContaining({
				kind: "image",
				text: "A World Cup themed poster",
				data: { src: source, mimeType: "image/png" },
			}),
		]);

		render(<PrettyMessagesView request="Draw a World Cup poster" response={response} />);
		expect(screen.getByText("Draw a World Cup poster")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "A World Cup themed poster" })).toHaveAttribute("src", source);
	});

	it("should explain a historically truncated image instead of rendering a broken image", () => {
		const response = {
			data: [
				{
					b64_json:
						"iVBORw0KGgo... (litellm_truncated skipped 100000 chars. Truncation is a DB storage safeguard.) ...IEND",
				},
			],
			output_format: "png",
		};

		const { container } = render(<PrettyMessagesView request="Draw an image" response={response} />);
		expect(screen.getByText("图片数据在日志入库时被截断，无法显示。")).toBeInTheDocument();
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});

	it("should render native Anthropic messages from a proxied request", () => {
		const request = {
			body: {
				messages: [{ role: "user", content: "Use the weather tool" }],
			},
		};
		const response = {
			id: "msg_123",
			type: "message",
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "I should call the tool" },
				{ type: "text", text: "Checking the weather." },
				{
					type: "tool_use",
					id: "toolu_123",
					name: "get_weather",
					input: { city: "Tokyo" },
				},
			],
		};

		render(<PrettyMessagesView request={request} response={response} />);

		expect(screen.getByText("Use the weather tool")).toBeInTheDocument();
		expect(screen.getByText(/I should call the tool/)).toBeInTheDocument();
		expect(screen.getByText(/Checking the weather\./)).toBeInTheDocument();
		expect(screen.getByText("get_weather")).toBeInTheDocument();
		expect(screen.queryByText("No response data available")).not.toBeInTheDocument();
	});

	it("should preserve OpenAI chat text and tool calls", () => {
		const parsed = parseMessages(
			{ messages: [{ role: "user", content: "Check Tokyo" }] },
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "Calling a tool",
							tool_calls: [
								{
									id: "call_123",
									function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
								},
							],
						},
					},
				],
			},
		);

		expect(parsed.responseMessage).toMatchObject({
			role: "assistant",
			content: "Calling a tool",
			toolCalls: [
				{
					id: "call_123",
					name: "get_weather",
					arguments: { city: "Tokyo" },
				},
			],
		});
		expect(parsed.responseMessage?.parts?.map((part) => part.kind)).toEqual(["text", "tool_call"]);
	});

	it("should preserve multiple OpenAI Responses API output text blocks", () => {
		const parsed = parseMessages(
			{},
			{
				output: [
					{
						type: "message",
						role: "assistant",
						content: [
							{ type: "output_text", text: "First" },
							{ type: "output_text", text: "Second" },
						],
					},
				],
			},
		);

		expect(parsed.responseMessage?.content).toBe("First\nSecond");
	});

	it("should prefer body messages and fall back to top-level messages when absent", () => {
		expect(
			parseMessages(
				{
					body: { messages: [{ role: "user", content: "Body message" }] },
					messages: [{ role: "user", content: "Top-level message" }],
				},
				{},
			).requestMessages,
		).toMatchObject([{ role: "user", content: "Body message", toolCallId: undefined }]);

		expect(
			parseMessages(
				{
					body: { model: "claude-test" },
					messages: [{ role: "user", content: "Top-level fallback" }],
				},
				{},
			).requestMessages,
		).toMatchObject([{ role: "user", content: "Top-level fallback", toolCallId: undefined }]);
	});

	it("should safely aggregate Anthropic special and tool blocks", () => {
		const parsed = parseMessages(
			{},
			{
				type: "message",
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Use the weather tool", signature: "thinking-secret" },
					{ type: "text", text: "Checking now." },
					{
						type: "tool_use",
						id: "toolu_123",
						name: "get_weather",
						input: '{"city":"Tokyo"}',
					},
					{
						type: "server_tool_use",
						id: "srvtoolu_123",
						name: "web_search",
						input: '{"query":',
					},
				],
			},
		);

		expect(parsed.responseMessage).toMatchObject({
			role: "assistant",
			content: "[Thinking]\nUse the weather tool\nChecking now.",
			toolCalls: [
				{
					id: "toolu_123",
					name: "get_weather",
					arguments: { city: "Tokyo" },
				},
				{
					id: "srvtoolu_123",
					name: "web_search",
					arguments: { raw: '{"query":' },
				},
			],
		});
		expect(parsed.responseMessage?.parts?.map((part) => part.kind)).toEqual([
			"thinking",
			"text",
			"tool_call",
			"tool_call",
		]);
		expect(parsed.responseMessage?.content).not.toContain("thinking-secret");
	});

	it.each(["tool_use", "server_tool_use"])("should render a pure %s Anthropic response", (type) => {
		const response = {
			type: "message",
			role: "assistant",
			content: [{ type, id: "tool_123", name: "lookup", input: { value: 1 } }],
		};

		render(<PrettyMessagesView request={{}} response={response} />);

		expect(screen.getByText("lookup")).toBeInTheDocument();
		expect(screen.queryByText("No response data available")).not.toBeInTheDocument();
	});

	it("should hide redacted thinking data and signatures from parser output and DOM", () => {
		const request = {
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "redacted_thinking",
							data: "request-redacted-secret",
							signature: "request-signature-secret",
						},
					],
				},
			],
		};
		const response = {
			type: "message",
			role: "assistant",
			content: [
				{
					type: "redacted_thinking",
					data: "response-redacted-secret",
					signature: "response-signature-secret",
				},
			],
		};
		const parsed = parseMessages(request, response);

		expect(parsed.requestMessages[0].content).toBe("[Redacted thinking]");
		expect(parsed.responseMessage?.content).toBe("[Redacted thinking]");
		expect(JSON.stringify(parsed)).not.toMatch(/redacted-secret|signature-secret/);

		render(<PrettyMessagesView request={request} response={response} />);
		expect(screen.getAllByText("Redacted thinking")).toHaveLength(2);
		expect(screen.getAllByText("Content redacted by provider")).toHaveLength(2);
		expect(screen.queryByText(/redacted-secret|signature-secret/)).not.toBeInTheDocument();
	});

	it("should preserve unknown Anthropic block type and payload", () => {
		const parsed = parseMessages(
			{},
			{
				type: "message",
				role: "assistant",
				content: [{ type: "future_block", payload: { answer: 42 } }, null, "primitive"],
			},
		);

		expect(parsed.responseMessage?.content).toContain("[Unknown block: future_block]");
		expect(parsed.responseMessage?.content).toContain('"payload":{"answer":42}');
		expect(parsed.responseMessage?.content).toContain("[Unknown block: unknown]\nnull");
		expect(parsed.responseMessage?.content).toContain("primitive");
	});

	it("should classify Anthropic tool_result blocks instead of rendering Unknown", () => {
		const request = {
			messages: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "The file has been updated successfully.",
							cache_control: { type: "ephemeral" },
						},
					],
				},
			],
		};

		render(<PrettyMessagesView request={request} response={{}} />);

		expect(screen.getByText("Tool result")).toBeInTheDocument();
		expect(screen.getByText("The file has been updated successfully.")).toBeInTheDocument();
		expect(screen.queryByText(/Unknown block: tool_result/)).not.toBeInTheDocument();
	});

	it("should classify OpenAI Responses operations in output order", () => {
		const parsed = parseMessages(
			{},
			{
				output: [
					{ type: "reasoning", summary: [{ type: "summary_text", text: "Check available data" }] },
					{ type: "web_search_call", id: "ws_1", status: "completed", query: "weather" },
					{ type: "function_call", call_id: "call_1", name: "save_result", arguments: '{"ok":true}' },
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] },
				],
			},
		);

		expect(parsed.responseMessage?.parts?.map((part) => part.kind)).toEqual([
			"thinking",
			"web_search",
			"tool_call",
			"text",
		]);
		expect(parsed.responseMessage?.toolCalls?.[0]).toMatchObject({ name: "save_result", arguments: { ok: true } });
	});

	it("should classify Gemini thought, function call, function response and code execution parts", () => {
		const parsed = parseMessages(
			{
				contents: [
					{
						role: "user",
						parts: [
							{ text: "Find the answer", thought: true },
							{ functionResponse: { name: "lookup", response: { result: 42 } } },
						],
					},
				],
			},
			{
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{ functionCall: { name: "lookup", args: { query: "answer" } } },
								{ executableCode: { language: "PYTHON", code: "print(42)" } },
								{ codeExecutionResult: { outcome: "OUTCOME_OK", output: "42" } },
							],
						},
					},
				],
			},
		);

		expect(parsed.requestMessages[0]?.parts?.map((part) => part.kind)).toEqual(["thinking", "tool_result"]);
		expect(parsed.responseMessage?.parts?.map((part) => part.kind)).toEqual(["tool_call", "code", "code_result"]);
	});

	it("should render the realtime pretty view for realtime API responses", () => {
		const request = {};
		const response = {
			results: [
				{
					type: "session.created",
					session: {
						id: "sess_123",
						model: "gpt-4o-mini-realtime-preview",
						voice: "alloy",
						modalities: ["audio", "text"],
					},
				},
				{
					type: "response.done",
					response: {
						id: "resp_1",
						status: "completed",
						output: [
							{
								id: "item_1",
								role: "assistant",
								type: "message",
								content: [{ type: "audio", transcript: "Hello from realtime!" }],
							},
						],
					},
				},
			],
		};

		render(<PrettyMessagesView request={request} response={response} />);
		expect(screen.getByText("Session")).toBeInTheDocument();
		expect(screen.getByText("Hello from realtime!")).toBeInTheDocument();
		const modelElements = screen.getAllByText("gpt-4o-mini-realtime-preview");
		expect(modelElements.length).toBeGreaterThanOrEqual(1);
	});

	it("should render standard view when response has results but no realtime events", () => {
		const request = {
			messages: [{ role: "user", content: "Test" }],
		};
		const response = {
			results: [{ type: "some.other.type" }],
			choices: [{ message: { role: "assistant", content: "Reply" } }],
		};

		render(<PrettyMessagesView request={request} response={response} />);
		expect(screen.getByText("Test")).toBeInTheDocument();
		expect(screen.getByText("Reply")).toBeInTheDocument();
	});
});
