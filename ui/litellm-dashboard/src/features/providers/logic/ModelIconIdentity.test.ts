import { describe, expect, it } from "vitest";
import { getModelIconIdentity, modelProviderHint } from "./ProviderIdentityLogic";

describe("model icons", () => {
	it.each([
		["deepseek/deepseek-v4.1-flash", "commandcode", "DeepSeek", "deepseek.svg", "commandcode.png"],
		["deepseek-v4.1-flash", "opencode-go", "DeepSeek", "deepseek.svg", "opencode.png"],
		["us.anthropic.claude-sonnet-4-5:0", "bedrock", "Claude", "claude.svg", "bedrock.svg"],
		["glm-5", "glm", "GLM", "glm.svg", "zai.svg"],
		["gpt-6-luna", "codex-subscription", "OpenAI", "openai_small.svg", "codex.svg"],
		["cliproxy/commandcode/z-ai/glm-5", "cliproxy", "GLM", "glm.svg", "commandcode.png"],
	])("resolves the family of %s independently of %s", (model, source, family, logo, badge) => {
		const result = getModelIconIdentity(model, source);
		expect(result.family?.displayName).toBe(family);
		expect(result.family?.logo.endsWith("/" + logo)).toBe(true);
		expect(result.supplier?.logo.endsWith("/" + badge)).toBe(true);
	});

	it("uses a configured base model for an opaque deployment and gives anonymous or mixed sources no badge", () => {
		expect(getModelIconIdentity("production-west", "azure", "gpt-4o").family?.displayName).toBe("OpenAI");
		expect(getModelIconIdentity("cliproxy/claude-opus", "cliproxy").supplier).toBeNull();
		expect(getModelIconIdentity("gpt-looking-alias", null, undefined, "Gemini").family?.displayName).toBe("Gemini");
		expect(getModelIconIdentity("gpt-looking-alias", null, undefined, null)).toEqual({ family: null, supplier: null });
		expect(getModelIconIdentity("private-unknown", "opencode-go").family).toBeNull();
	});

	it("derives a provider hint only from an explicit subscription model prefix", () => {
		expect(modelProviderHint("cliproxy/commandcode/deepseek/deepseek-v4.1-flash")).toBe("commandcode");
		expect(modelProviderHint("opencode-go/deepseek-v4.1-flash")).toBe("opencode-go");
		expect(modelProviderHint("codex-subscription/gpt-6-luna")).toBe("codex-subscription");
		expect(modelProviderHint("gpt-6-luna")).toBe("");
		expect(modelProviderHint("my-team/claude-sonnet")).toBe("");
	});
});
