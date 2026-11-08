import { computed } from "vue";
import { describe, expect, it } from "vitest";
import { getGuardrailLogoAndName, populateGuardrailProviders } from "./GuardrailProviderLogic";

describe("Guardrail provider metadata", () => {
	it("refreshes an already rendered provider name and logo when asynchronous metadata arrives", () => {
		populateGuardrailProviders({});
		const displayed = computed(() => getGuardrailLogoAndName("litellm_content_filter"));
		expect(displayed.value).toEqual({ displayName: "litellm_content_filter", logo: "" });
		populateGuardrailProviders({ litellm_content_filter: { ui_friendly_name: "LiteLLM Content Filter" } });
		expect(displayed.value.displayName).toBe("LiteLLM Content Filter");
		expect(displayed.value.logo).toMatch(/litellm_logo\.jpg$/);
		populateGuardrailProviders({});
	});
});
