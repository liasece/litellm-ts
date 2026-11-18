import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modelFamilies } from "../../../../../../src/shared/ModelFamily";
import { getModelIconIdentity, modelProviderHint } from "./ProviderIdentityLogic";

describe("model icons", () => {
	it.each([
		["deepseek/deepseek-v4.1-flash", "commandcode", "DeepSeek", "deepseek.svg", "commandcode.png"],
		["deepseek-v4.1-flash", "opencode-go", "DeepSeek", "deepseek.svg", "opencode.png"],
		["us.anthropic.claude-sonnet-4-5:0", "bedrock", "Claude", "claude.svg", "bedrock.svg"],
		["glm-5", "glm", "GLM", "glm.svg", "zai.svg"],
		["hunyuan-turbo", "bedrock", "Hunyuan", "hunyuan.svg", "bedrock.svg"],
		["tencent/HunyuanVideo", "opencode-go", "Hunyuan", "hunyuan.svg", "opencode.png"],
		["hy4-flash", "opencode-go", "Hunyuan", "hunyuan.svg", "opencode.png"],
		["openai/hy3-preview", "bedrock", "Hunyuan", "hunyuan.svg", "bedrock.svg"],
		["gpt-6-luna", "codex-subscription", "OpenAI", "openai_small.svg", "codex.svg"],
		["cliproxy/commandcode/z-ai/glm-5", "cliproxy", "GLM", "glm.svg", "commandcode.png"],
	])("resolves the family of %s independently of %s", (model, source, family, logo, badge) => {
		const result = getModelIconIdentity(model, source);
		expect(result.family?.displayName).toBe(family);
		expect(result.family?.logo.endsWith("/" + logo)).toBe(true);
		expect(result.supplier?.logo.endsWith("/" + badge)).toBe(true);
	});

	it("gives alias names that are plain Anthropic tiers the Claude icon", () => {
		// 别名表里会出现 opus / haiku / sonnet 这类纯档位名，图标应与 claude-* 部署一致。
		for (const alias of ["opus", "haiku", "sonnet", "opus-4-6", "haiku35"]) {
			expect(getModelIconIdentity(alias, null).family?.displayName).toBe("Claude");
			expect(getModelIconIdentity(alias, null).family?.logo.endsWith("/claude.svg")).toBe(true);
		}
	});

	it("uses a configured base model for an opaque deployment and gives anonymous or mixed sources no badge", () => {
		expect(getModelIconIdentity("production-west", "azure", "gpt-4o").family?.displayName).toBe("OpenAI");
		expect(getModelIconIdentity("hunyuan-deploy", "tencent", "Hunyuan-A13B").family?.displayName).toBe("Hunyuan");
		expect(getModelIconIdentity("alias", null, undefined, "Hunyuan").family?.logo.endsWith("/hunyuan.svg")).toBe(true);
		expect(getModelIconIdentity("cliproxy/claude-opus", "cliproxy").supplier).toBeNull();
		expect(getModelIconIdentity("gpt-looking-alias", null, undefined, "Gemini").family?.displayName).toBe("Gemini");
		expect(getModelIconIdentity("gpt-looking-alias", null, undefined, null)).toEqual({ family: null, supplier: null });
		expect(getModelIconIdentity("private-unknown", "opencode-go").family).toBeNull();
		expect(getModelIconIdentity("hyenadna-7b", null).family).toBeNull();
	});

	it("ships an existing icon asset for every recognized model family", () => {
		const missing = modelFamilies.filter((family) => {
			const logo = getModelIconIdentity("placeholder", null, undefined, family).family?.logo;
			const asset = logo?.split("/").at(-1);
			return !asset || !existsSync(fileURLToPath(new URL(`../../../../public/assets/logos/${asset}`, import.meta.url)));
		});
		expect(missing).toEqual([]);
	});

	it("derives a provider hint only from an explicit subscription model prefix", () => {
		expect(modelProviderHint("cliproxy/commandcode/deepseek/deepseek-v4.1-flash")).toBe("commandcode");
		expect(modelProviderHint("opencode-go/deepseek-v4.1-flash")).toBe("opencode-go");
		expect(modelProviderHint("codex-subscription/gpt-6-luna")).toBe("codex-subscription");
		expect(modelProviderHint("gpt-6-luna")).toBe("");
		expect(modelProviderHint("my-team/claude-sonnet")).toBe("");
	});
});
