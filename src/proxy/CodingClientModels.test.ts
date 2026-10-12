import { claudeCodeModelId, resolveCodingClientModel } from "./CodingClientModels";

describe("coding client model resolution", () => {
	const router = { hasModel: (model: string) => ["fast-model", "literal-fast", "gpt-6-sol"].includes(model) };
	it("round-trips arbitrary UTF-8 model names without decoding unconfigured names", () => {
		expect(resolveCodingClientModel({ model: claudeCodeModelId("fast-model") }, router)).toEqual({ model: "fast-model" });
		expect(resolveCodingClientModel({ model: "claude-router-ff" }, router)).toEqual({ model: "claude-router-ff" });
		expect(resolveCodingClientModel({ model: claudeCodeModelId("unknown") }, router)).toEqual({ model: claudeCodeModelId("unknown") });
	});
	it("gives configured literal names precedence and retains explicit effort", () => {
		expect(resolveCodingClientModel({ model: "literal-fast" }, router, true)).toEqual({ model: "literal-fast" });
		expect(
			resolveCodingClientModel({ model: "gpt-6-sol-thinking-xhigh-fast", messages: [], reasoning_effort: "low" }, router, true),
		).toEqual({ model: "gpt-6-sol", messages: [], reasoning_effort: "low" });
		expect(
			resolveCodingClientModel({ model: "gpt-6-sol-thinking-xhigh-fast", input: "hi", reasoning: { summary: "auto" } }, router, true),
		).toEqual({ model: "gpt-6-sol", input: "hi", reasoning: { summary: "auto", effort: "xhigh" } });
	});
});

it.each(["glm-5-turbo-anthropic", "anthropic/my-chat", "my-claude-alias"])(
	"encodes a noncanonical logical alias %s and resolves it back to the configured model",
	(model) => {
		const id = claudeCodeModelId(model);
		expect(id).toMatch(/^claude-router-/);
		expect(resolveCodingClientModel({ model: id }, { hasModel: (candidate) => candidate === model })).toEqual({ model });
		expect(claudeCodeModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
	},
);
