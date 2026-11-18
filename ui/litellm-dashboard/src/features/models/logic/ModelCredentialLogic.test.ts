import { describe, expect, it } from "vitest";
import { subscriptionCredential } from "./ModelCredentialLogic";

describe("subscription credential column", () => {
	it("maps every subscription slug to its brand and account page", () => {
		const cases: [string, string, string][] = [
			["codex-subscription", "Codex", "codex.svg"],
			["claude-subscription", "Claude", "claude.svg"],
			["kimi-subscription", "Kimi", "kimi.svg"],
			["antigravity-subscription", "Antigravity", "antigravity.svg"],
			["xai-subscription", "xAI", "grok.svg"],
			["commandcode", "CommandCode", "commandcode.png"],
			["opencode-go", "OpenCode", "opencode.png"],
		];
		for (const [slug, label, asset] of cases) {
			const credential = subscriptionCredential(slug, "/ui");
			expect(credential?.brand.label).toBe(label);
			expect(credential?.brand.logo.endsWith("/" + asset)).toBe(true);
			expect(credential?.href).toBe("/ui/?page=subscriptions&provider=" + slug);
		}
	});

	it("leaves API-key providers and empty values to the credential / manual branches", () => {
		// 这些部署真的有 credential 名或需要手工配置，不能显示成订阅。
		for (const provider of ["openai", "anthropic", "minimax", "deepseek", "", null, undefined]) {
			expect(subscriptionCredential(provider)).toBeNull();
		}
	});

	it("keeps the dashboard root prefix in the account link", () => {
		expect(subscriptionCredential("codex-subscription", "/proxy/ui")?.href).toBe(
			"/proxy/ui/?page=subscriptions&provider=codex-subscription",
		);
	});
});
