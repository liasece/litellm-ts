import { describe, it, expect } from "vitest";
import {
	extractVariables,
	convertToDotPrompt,
	parseExistingPrompt,
	getVersionNumber,
	stripVersionFromPromptId,
} from "./PromptSerializationLogic";
import { emptyPrompt } from "../stores/PromptEditorStore";
describe("Dotprompt editor serialization", () => {
	it("keeps first-occurrence variable order and deduplicates messages and developer variables", () => {
		const draft = emptyPrompt();
		draft.messages = [
			{ role: "user", content: "{{user}} {{shared}} {{user}} {{not-valid}}" },
			{ role: "assistant", content: "{{answer}}" },
		];
		draft.developerMessage = "{{shared}} {{developer}}";
		expect(extractVariables(draft)).toEqual(["user", "shared", "answer", "developer"]);
	});
	it("round trips multi-line messages, system roles, repeated developer blocks, tool JSON and explicit zero parameters", () => {
		const content =
			'---\nmodel: custom/model\ntemperature: 0\nmax_tokens: 0\ntop_p: 0\ninput:\n  schema:\n    name: string\ntools:\n  - {"type":"function","function":{"name":"lookup","description":"Synthetic tool"}}\n---\nDeveloper: First line\ncontinuation\n\nSystem: System text\n\nDeveloper: Second block\n\nUser: Hi {{name}}\nSecond user line\n\nAssistant: ';
		const result = parseExistingPrompt({
			prompt_spec: { prompt_id: "sample.v12", litellm_params: { dotprompt_content: content } },
			raw_prompt_template: null,
		});
		expect(result).toMatchObject({
			name: "sample",
			model: "custom/model",
			config: { temperature: 0, max_tokens: 0, top_p: 0 },
			developerMessage: "First line\ncontinuation\n\nSecond block",
			messages: [
				{ role: "system", content: "System text" },
				{ role: "user", content: "Hi {{name}}\nSecond user line" },
				{ role: "assistant", content: "" },
			],
			tools: [{ name: "lookup", description: "Synthetic tool" }],
		});
		const serialized = convertToDotPrompt(result);
		expect(serialized).toContain("temperature: 0\nmax_tokens: 0\ntop_p: 0");
		expect(serialized).toContain("    name: string");
		expect(serialized).toContain('  - {"type":"function","function":{"name":"lookup","description":"Synthetic tool"}}');
		expect(
			parseExistingPrompt({
				prompt_spec: { prompt_id: "sample", litellm_params: { dotprompt_content: serialized } },
				raw_prompt_template: null,
			}),
		).toEqual({ ...result, name: "sample" });
	});
	it("skips invalid optional frontmatter tool lines and leaves ordinary body separators intact", () => {
		const parsed = parseExistingPrompt({
			prompt_spec: {
				prompt_id: "example-v3",
				litellm_params: {
					dotprompt_content:
						'---\nmodel: gpt-4o\ntools:\n  - invalid-json\n  - {"function":{"name":"good"}}\n---\nUser: beginning\n---\nend',
				},
			},
			raw_prompt_template: null,
		});
		expect(parsed.name).toBe("example");
		expect(parsed.tools.map((tool) => tool.name)).toEqual(["good"]);
		expect(parsed.messages[0].content).toBe("beginning\n---\nend");
	});
	it("rejects missing or malformed source and uses the documented default message only for an empty valid body", () => {
		expect(() => parseExistingPrompt({ prompt_spec: { prompt_id: "x" }, raw_prompt_template: null })).toThrow("No dotprompt_content");
		expect(() =>
			parseExistingPrompt({
				prompt_spec: { prompt_id: "x", litellm_params: { dotprompt_content: "not frontmatter" } },
				raw_prompt_template: null,
			}),
		).toThrow("Invalid dotprompt");
		const parsed = parseExistingPrompt({
			prompt_spec: { prompt_id: "x", litellm_params: { dotprompt_content: "---\nmodel: custom\n---\n" } },
			raw_prompt_template: null,
		});
		expect(parsed.messages).toEqual(emptyPrompt().messages);
	});
	it("extracts only a terminal numeric version suffix", () => {
		for (const separator of [".", "_", "-"]) {
			expect(getVersionNumber("example" + separator + "v42")).toBe("42");
			expect(stripVersionFromPromptId("example" + separator + "v42")).toBe("example");
		}
		expect(getVersionNumber("example.v2.middle")).toBe("1");
		expect(stripVersionFromPromptId("example.v2.middle")).toBe("example.v2.middle");
	});
});
