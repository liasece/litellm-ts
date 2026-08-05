import { applyReasoningEffortOverride, getReasoningEffortOverride, REASONING_EFFORT_OVERRIDE_VALUES } from "./ReasoningEffortOverride";
import type { Deployment } from "../types/router";

function deployment(override?: unknown): Deployment {
	return {
		model_name: "public-model",
		litellm_params: { model: "provider/model" },
		model_info: override === undefined ? {} : ({ override_reasoning_effort: override } as never),
	};
}

describe("reasoning effort override", () => {
	it("replaces the caller effort in each outbound protocol without dropping sibling settings", () => {
		const configured = deployment("xhigh");

		expect(
			applyReasoningEffortOverride({ reasoning: { effort: "low", summary: "detailed" }, input: "hello" }, configured, "responses"),
		).toEqual({
			reasoning: { effort: "xhigh", summary: "detailed" },
			input: "hello",
		});
		expect(
			applyReasoningEffortOverride({ output_config: { effort: "low", format: { type: "json_schema" } } }, configured, "anthropic"),
		).toEqual({
			output_config: { effort: "xhigh", format: { type: "json_schema" } },
		});
		expect(
			applyReasoningEffortOverride({ reasoning_effort: "low", reasoning: { effort: "low", summary: "auto" } }, configured, "chat"),
		).toEqual({
			reasoning_effort: "xhigh",
			reasoning: { effort: "xhigh", summary: "auto" },
		});
	});

	it("returns the original body when no override is configured", () => {
		const body = { reasoning: { effort: "low" } };
		expect(applyReasoningEffortOverride(body, deployment(), "responses")).toBe(body);
	});

	it("accepts the Codex request-level effort values and rejects unknown values", () => {
		for (const effort of REASONING_EFFORT_OVERRIDE_VALUES) {
			expect(getReasoningEffortOverride(deployment(effort))).toBe(effort);
		}
		expect(() => getReasoningEffortOverride(deployment("ultra"))).toThrow("override_reasoning_effort must be one of");
	});

	it("rejects Codex-only minimal effort for Anthropic requests", () => {
		expect(() => applyReasoningEffortOverride({}, deployment("minimal"), "anthropic")).toThrow(
			"Anthropic reasoning effort override does not support minimal",
		);
	});
});
