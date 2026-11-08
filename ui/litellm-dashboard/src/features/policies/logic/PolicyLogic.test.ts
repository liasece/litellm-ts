import { describe, it, expect } from "vitest";
import {
	groupPolicies,
	resolvedGuardrails,
	derivePipeline,
	attachmentData,
	simplePolicyData,
	templateHasTags,
	substituteTemplate,
	normalizeCompetitors,
} from "./PolicyLogic";
import { policySchema, templateSchema } from "../api/PoliciesSchemas";
import { policyFixtureBase, policyFixtureDraft, policyFixtureChild, policyFixtureTemplates } from "../../../../tests/policies/Fixtures";
describe("policy configuration contracts", () => {
	it("groups all versions by name and opens production even when a newer draft exists", () => {
		const rows = groupPolicies([policyFixtureDraft, policyFixtureChild, policyFixtureBase].map((v) => policySchema.parse(v)));
		expect(rows.map((r) => [r.name, r.versionCount, r.policy.policy_id])).toEqual([
			["global-baseline", 2, "fixture-base-v1"],
			["healthcare-compliance", 1, "fixture-health-v1"],
		]);
	});
	it("resolves inherited guardrails before child additions and removals without recursing forever on cycles", () => {
		const parent = policySchema.parse(policyFixtureBase),
			child = policySchema.parse({ ...policyFixtureChild, guardrails_remove: ["fixture-injection"] });
		expect(resolvedGuardrails([parent, child], child.policy_name, ["fixture-extra"], ["fixture-topic"])).toEqual([
			"fixture-extra",
			"fixture-pii",
		]);
		expect(resolvedGuardrails([{ ...parent, inherit: child.policy_name }, child], parent.policy_name, [], [])).toContain(
			"fixture-injection",
		);
	});
	it("converts simple policies into ordered steps and copies a pipeline before editing another version", () => {
		const legacy = policySchema.parse(policyFixtureChild),
			pipeline = derivePipeline(legacy);
		expect(pipeline.steps.map((s) => [s.guardrail, s.on_pass, s.on_fail])).toEqual([
			["fixture-pii", "next", "block"],
			["fixture-topic", "next", "block"],
		]);
		const original = policySchema.parse(policyFixtureDraft),
			copy = derivePipeline(original);
		copy.steps[0]!.on_fail = "allow";
		expect(original.pipeline!.steps[0]!.on_fail).toBe("block");
	});
	it("global attachments omit stale specific scope and simple writes omit empty optional restrictions", () => {
		const form = { teams: ["health-*"], keys: [], models: ["gpt-*"], tags: ["prod"] };
		expect(attachmentData(form, "baseline", "global")).toEqual({ policy_name: "baseline", scope: "*" });
		expect(attachmentData(form, "baseline", "specific")).toEqual({
			policy_name: "baseline",
			teams: ["health-*"],
			models: ["gpt-*"],
			tags: ["prod"],
		});
		expect(
			JSON.parse(
				JSON.stringify(
					simplePolicyData({
						policy_name: "baseline",
						description: "",
						inherit: "",
						guardrails_add: [],
						guardrails_remove: [],
						model_condition: "",
					}),
				),
			),
		).toEqual({ policy_name: "baseline", guardrails_add: [], guardrails_remove: [] });
	});
	it("combines category filters with AND and substitutes all parameter occurrences while preserving the original template", () => {
		const template = templateSchema.parse(policyFixtureTemplates[1]);
		expect(templateHasTags(template, new Set(["Privacy", "Healthcare"]))).toBe(true);
		expect(templateHasTags(template, new Set(["Privacy", "Security"]))).toBe(false);
		const configured = substituteTemplate(template, { department: "Support" });
		expect(configured.templateData.description).toBe("Protect Support requests");
		expect(template.templateData.description).toBe("Protect {{department}} requests");
		expect(normalizeCompetitors([" Example ", "example", "Other", ""])).toEqual(["Example", "Other"]);
	});
});
