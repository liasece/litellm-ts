import { describe, expect, it } from "vitest";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import {
	SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES,
	SUBSCRIPTION_PROVIDER_SLUGS,
	isSubscriptionProviderSlug,
	providerSlugFromValue,
	subscriptionModelName,
} from "./SubscriptionProviderLogic";

describe("subscription provider registry", () => {
	it("publishes the seven first-party slugs with their account sources", () => {
		expect(SUBSCRIPTION_PROVIDER_SLUGS).toEqual([
			"codex-subscription",
			"commandcode",
			"opencode-go",
			"kimi-subscription",
			"claude-subscription",
			"antigravity-subscription",
			"xai-subscription",
		]);
		expect(SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES).toEqual({
			"codex-subscription": "codex",
			commandcode: "commandcode",
			"opencode-go": "opencode-go",
			"kimi-subscription": "kimi",
			"claude-subscription": "claude",
			"antigravity-subscription": "antigravity",
			"xai-subscription": "xai",
		});
	});

	it("resolves catalog display names and slugs to the same public provider slug", () => {
		expect(providerSlugFromValue("Codex Subscription")).toBe("codex-subscription");
		expect(providerSlugFromValue("CommandCode")).toBe("commandcode");
		expect(providerSlugFromValue("OpenCode Go")).toBe("opencode-go");
		expect(providerSlugFromValue("xAI Subscription")).toBe("xai-subscription");
		expect(providerSlugFromValue("codex-subscription")).toBe("codex-subscription");
		expect(providerSlugFromValue(" OpenAI ")).toBe("openai");
		expect(providerSlugFromValue("")).toBe("");
	});

	it("recognizes only active subscription providers", () => {
		expect(isSubscriptionProviderSlug("cliproxy")).toBe(false);
		expect(isSubscriptionProviderSlug("codex-subscription")).toBe(true);
	});

	it("renders each subscription slug with its catalog display name and brand logo", () => {
		const expected: Record<string, string> = {
			"codex-subscription": "Codex Subscription",
			commandcode: "CommandCode",
			"opencode-go": "OpenCode Go",
			"kimi-subscription": "Kimi Subscription",
			"claude-subscription": "Claude Subscription",
			"antigravity-subscription": "Antigravity Subscription",
			"xai-subscription": "xAI Subscription",
		};
		for (const [slug, displayName] of Object.entries(expected)) {
			const identity = getProviderLogoAndName(slug);
			expect(identity.displayName).toBe(displayName);
			expect(identity.logo).toMatch(/\/ui\/assets\/logos\/[a-z]+\.(?:svg|png)$/);
		}
	});

	it("builds canonical model names without duplicating the provider prefix", () => {
		expect(subscriptionModelName("codex-subscription", "gpt-5.4-codex")).toBe("gpt-5.4-codex");
		expect(subscriptionModelName("commandcode", "glm-5.3")).toBe("glm-5.3");
		expect(subscriptionModelName("opencode-go", "opencode-go/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
		expect(subscriptionModelName(" Codex-Subscription ", "gpt-5.4")).toBe("gpt-5.4");
	});
});
