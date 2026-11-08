import { describe, expect, it } from "vitest";
import { getProviderBrand } from "./ProviderBrands";

describe("getProviderBrand", () => {
	it("resolves OAuth login ids and auth file aliases to the same official brand", () => {
		expect(getProviderBrand("codex-device")).toMatchObject({ key: "codex", label: "Codex" });
		expect(getProviderBrand("anthropic")).toMatchObject({ key: "claude", label: "Claude" });
		expect(getProviderBrand("grok")).toMatchObject({ key: "xai", label: "xAI" });
		expect(getProviderBrand("kimi-ai")).toMatchObject({ key: "kimi", label: "Kimi" });
		for (const provider of ["codex", "claude", "xai", "kimi", "antigravity"]) {
			expect(getProviderBrand(provider).logo).toMatch(/^.*\/ui\/assets\/logos\/[a-z]+\.svg$/);
		}
	});

	it("maps plugin account providers to their own brand images", () => {
		expect(getProviderBrand("commandcode").logo).toMatch(/\/ui\/assets\/logos\/commandcode\.png$/);
		expect(getProviderBrand("opencode-go")).toMatchObject({ key: "opencode", label: "OpenCode" });
		expect(getProviderBrand("opencode-go").logo).toMatch(/\/ui\/assets\/logos\/opencode\.png$/);
	});

	it("maps built-in provider quota accounts to their own brand images", () => {
		expect(getProviderBrand("deepseek")).toMatchObject({ key: "deepseek", label: "DeepSeek" });
		expect(getProviderBrand("deepseek").logo).toMatch(/\/ui\/assets\/logos\/deepseek\.svg$/);
		expect(getProviderBrand("minimax")).toMatchObject({ key: "minimax", label: "MiniMax" });
		expect(getProviderBrand("minimax").logo).toMatch(/\/ui\/assets\/logos\/minimax\.svg$/);
	});

	it("keeps unknown providers identifiable with the raw label and no image", () => {
		expect(getProviderBrand(" future-provider ")).toEqual({
			key: "future-provider",
			label: "future-provider",
			logo: "",
			color: "default",
		});
	});
});
