import { afterEach, it, expect, vi } from "vitest";
import { createPoliciesStore } from "./PoliciesStore";
import { createPolicyTemplateStore } from "./PolicyTemplateStore";
import { guardrailsApi } from "../../guardrails/api/GuardrailsApi";
import { templateSchema } from "../api/PoliciesSchemas";
import { policyFixtureTemplates } from "../../../../tests/policies/Fixtures";
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});
it("continues template setup after partial guardrail failure and serializes the remaining AI template queue", async () => {
	vi.useFakeTimers();
	vi.spyOn(guardrailsApi, "list").mockResolvedValue([]);
	const create = vi.spyOn(guardrailsApi, "create").mockImplementation(async (definition) => {
		if (definition.guardrail_name === "fixture-new-filter") throw new Error("Unavailable");
		return {};
	});
	const page = createPoliciesStore(),
		store = createPolicyTemplateStore(page),
		templates = policyFixtureTemplates.slice(0, 2).map((v) => templateSchema.parse(v));
	store.select(templates);
	await vi.waitFor(() => expect(store.state.selectionOpen).toBe(true));
	expect(store.state.progress).toEqual({ current: 1, total: 2 });
	await store.confirm(templates[0]!.guardrailDefinitions);
	expect(create).toHaveBeenCalledTimes(2);
	expect(page.state.addOpen).toBe(true);
	expect(page.state.tab).toBe("policies");
	expect(page.state.editing?.policy_name).toBe("security-baseline");
	await vi.advanceTimersByTimeAsync(500);
	expect(store.state.parameterOpen).toBe(true);
	expect(store.state.pending?.id).toBe("fixture-healthcare");
	expect(store.state.progress).toEqual({ current: 2, total: 2 });
	store.cancelSelection();
	expect(store.state.queue).toEqual([]);
	expect(store.state.progress).toBeNull();
	store.dispose();
	page.dispose();
});
