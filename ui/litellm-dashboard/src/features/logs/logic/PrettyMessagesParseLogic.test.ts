import { describe, expect, it } from "vitest";
import { parseRequestMessages, parseResponseMessage } from "./PrettyMessagesParseLogic";
import { parseRequestMeta } from "./PrettyMessagesMetaLogic";
describe("provider-neutral Pretty messages", () => {
	it("uses real reasoning content when an empty Responses summary is present", () => {
		const result = parseResponseMessage({
			output: [
				{ type: "reasoning", summary: [], content: [{ text: "Plan before answering" }] },
				{ type: "message", content: [{ type: "output_text", text: "Answer" }] },
			],
		});
		expect(result?.parts?.map((part) => part.kind)).toEqual(["thinking", "text"]);
		expect(result?.parts?.[0].text).toBe("Plan before answering");
	});
	it("keeps encrypted thinking explicit and drops whitespace-only reasoning", () => {
		const result = parseResponseMessage({
			type: "message",
			content: [
				{ type: "thinking", thinking: "", signature: "fixture-signature" },
				{ type: "thinking", thinking: " " },
				{ type: "text", text: "Visible" },
			],
		});
		expect(result?.parts?.map((part) => part.kind)).toEqual(["redacted_thinking", "text"]);
	});
	it("preserves multimodal tool output and pairs its call id", () => {
		const messages = parseRequestMessages({
			body: {
				messages: [
					{ role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "screenshot", input: { path: "fixture" } }] },
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "tool-1",
								content: [
									{ type: "text", text: "Captured" },
									{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
								],
							},
						],
					},
				],
			},
		});
		expect(messages[0].toolCalls?.[0].name).toBe("screenshot");
		expect(messages[1].parts?.[0].id).toBe("tool-1");
		expect(messages[1].parts?.[0].parts?.map((part) => part.kind)).toEqual(["text", "image"]);
	});
	it("parses Gemini instructions, tool calls and responses", () => {
		const request = parseRequestMessages({ contents: [{ role: "user", parts: [{ text: "Find it" }] }], system: "Be concise" });
		expect(request.map((message) => message.role)).toEqual(["system", "user"]);
		const response = parseResponseMessage({
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{ functionCall: { name: "lookup", args: { q: "fixture" } } },
							{ functionResponse: { name: "lookup", response: { value: 42 } } },
						],
					},
				},
			],
		});
		expect(response?.parts?.map((part) => part.kind)).toEqual(["tool_call", "tool_result"]);
	});
	it("shows built-in search sources and truncated generated images without losing the result", () => {
		const search = parseResponseMessage({
			brief: "Result",
			results: [{ title: "Source", url: "https://example.test", snippet: "Supporting text" }],
			executor: "search-fixture",
		});
		expect(search?.parts?.find((part) => part.kind === "web_search")?.text).toContain("Supporting text");
		const image = parseResponseMessage({ data: [{ b64_json: "litellm_truncated" }] });
		expect(image?.parts?.[0].data).toEqual({ truncated: true });
	});
	it("keeps missing block references at their message position instead of parsing them as content", () => {
		const messages = parseRequestMessages({
			body: {
				messages: [
					{ role: "user", content: "before" },
					{ _litellm_ref_missing: "aB3dE6fH9jK2mN5pQ8rS1t" },
					{ role: "assistant", content: "after" },
				],
			},
		});
		expect(messages.map((message) => message.content)).toEqual(["before", "", "after"]);
		expect(messages[1].missingBlockRef).toBe(true);
		expect(messages[0].missingBlockRef).toBeUndefined();
		const inputItems = parseRequestMessages({
			input: [{ _litellm_ref_missing: "aB3dE6fH9jK2mN5pQ8rS1t" }, { type: "message", role: "user", content: "real" }],
		});
		expect(inputItems.map((message) => message.missingBlockRef)).toEqual([true, undefined]);
		expect(inputItems[1].content).toBe("real");
	});
	it("keeps provider tool schema and other definition fields when normalizing request metadata", () => {
		const meta = parseRequestMeta({
			body: {
				model: "fixture",
				output_config: { effort: "high" },
				thinking: { budget_tokens: 2000 },
				tools: [
					{
						type: "function",
						function: { name: "lookup", description: "Find data", parameters: { type: "object" }, strict: true },
					},
					{ type: "web_search", max_uses: 3 },
				],
				stream: true,
				max_completion_tokens: 100,
			},
		});
		expect(meta.reasoningEffort).toBe("high");
		expect(meta.tools[0].extra).toEqual({ "function.strict": true });
		expect(meta.tools[1].name).toBe("web_search");
		expect(meta.maxTokens).toBe(100);
	});
});
