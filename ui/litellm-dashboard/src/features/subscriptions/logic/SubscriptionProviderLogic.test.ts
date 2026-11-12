import { describe, expect, it } from "vitest";
import { isSubscriptionProviderSlug, providerSlugFromValue, subscriptionModelName } from "./SubscriptionProviderLogic";

describe("subscription provider registry", () => {
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

	it("builds canonical model names without duplicating the provider prefix", () => {
		expect(subscriptionModelName("codex-subscription", "gpt-5.4-codex")).toBe("gpt-5.4-codex");
		expect(subscriptionModelName("commandcode", "glm-5.3")).toBe("glm-5.3");
		expect(subscriptionModelName("opencode-go", "opencode-go/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
		expect(subscriptionModelName(" Codex-Subscription ", "gpt-5.4")).toBe("gpt-5.4");
	});
});
