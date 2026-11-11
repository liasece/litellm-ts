import {
	applyReasoningEffortOverride,
	getForcedReasoningEffort,
	getReasoningEffortOverride,
	REASONING_EFFORT_OVERRIDE_VALUES,
} from "./ReasoningEffortOverride";
import type { Deployment } from "../types/router";

function deployment(settings: { defaultEffort?: unknown; forcedEffort?: unknown } = {}): Deployment {
	const modelInfo: Record<string, unknown> = {};
	if (settings.defaultEffort !== undefined) modelInfo["override_reasoning_effort"] = settings.defaultEffort;
	if (settings.forcedEffort !== undefined) modelInfo["force_reasoning_effort"] = settings.forcedEffort;
	return {
		model_name: "public-model",
		litellm_params: { model: "provider/model" },
		model_info: modelInfo as never,
	};
}

describe("reasoning effort override", () => {
	it("replaces the caller effort in each outbound protocol for the forced setting without dropping sibling settings", () => {
		const configured = deployment({ forcedEffort: "xhigh" });

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

	it("applies the default effort only when the caller request sets none", () => {
		const configured = deployment({ defaultEffort: "high" });

		expect(applyReasoningEffortOverride({ messages: [] }, configured, "responses")).toEqual({
			messages: [],
			reasoning: { effort: "high" },
		});
		expect(applyReasoningEffortOverride({ reasoning: { effort: "low" } }, configured, "responses")).toEqual({
			reasoning: { effort: "low" },
		});
		expect(applyReasoningEffortOverride({ messages: [] }, configured, "chat")).toEqual({
			messages: [],
			reasoning_effort: "high",
		});
		expect(applyReasoningEffortOverride({ reasoning: { effort: "low" } }, configured, "chat")).toEqual({
			reasoning: { effort: "low" },
		});
		expect(applyReasoningEffortOverride({ messages: [] }, configured, "anthropic")).toEqual({
			messages: [],
			output_config: { effort: "high" },
		});
		expect(applyReasoningEffortOverride({ output_config: { effort: "low" } }, configured, "anthropic")).toEqual({
			output_config: { effort: "low" },
		});
	});

	it("leaves an explicit caller thinking configuration to the caller", () => {
		const configured = deployment({ defaultEffort: "high" });

		expect(applyReasoningEffortOverride({ thinking: { type: "enabled", budget_tokens: 32000 } }, configured, "anthropic")).toEqual({
			thinking: { type: "enabled", budget_tokens: 32000 },
		});
		expect(applyReasoningEffortOverride({ thinking: { type: "disabled" } }, configured, "chat")).toEqual({
			thinking: { type: "disabled" },
		});
	});

	it("lets the forced setting win over the default and the caller effort", () => {
		const configured = deployment({ defaultEffort: "low", forcedEffort: "max" });

		expect(applyReasoningEffortOverride({ reasoning_effort: "medium" }, configured, "chat")).toEqual({ reasoning_effort: "max" });
		expect(applyReasoningEffortOverride({}, configured, "anthropic")).toEqual({ output_config: { effort: "max" } });
	});

	it("detects the caller choice in request params instead of the merged deployment body", () => {
		const configured = deployment({ defaultEffort: "high" });

		// Deployments carry static reasoning_effort in litellm_params; a silent caller still gets the model default.
		expect(applyReasoningEffortOverride({ reasoning_effort: "low" }, configured, "chat", {})).toEqual({ reasoning_effort: "high" });
		expect(applyReasoningEffortOverride({ reasoning_effort: "medium" }, configured, "chat", { reasoning_effort: "medium" })).toEqual({
			reasoning_effort: "medium",
		});
	});

	it("returns the original body when no setting is configured", () => {
		const body = { reasoning: { effort: "low" } };
		expect(applyReasoningEffortOverride(body, deployment(), "responses")).toBe(body);
	});

	it("returns the original body when the caller chose an effort and only a default exists", () => {
		const body = { reasoning_effort: "low" };
		expect(applyReasoningEffortOverride(body, deployment({ defaultEffort: "high" }), "chat")).toBe(body);
	});

	it("accepts every request-level effort value and rejects unknown values", () => {
		for (const effort of REASONING_EFFORT_OVERRIDE_VALUES) {
			expect(getReasoningEffortOverride(deployment({ defaultEffort: effort }))).toBe(effort);
			expect(getForcedReasoningEffort(deployment({ forcedEffort: effort }))).toBe(effort);
		}
		expect(() => getReasoningEffortOverride(deployment({ defaultEffort: "ultra" }))).toThrow(
			"override_reasoning_effort must be one of",
		);
		expect(() => getForcedReasoningEffort(deployment({ forcedEffort: "ultra" }))).toThrow("force_reasoning_effort must be one of");
	});

	it("rejects Codex-only minimal effort for Anthropic requests", () => {
		expect(() => applyReasoningEffortOverride({}, deployment({ forcedEffort: "minimal" }), "anthropic")).toThrow(
			"Anthropic reasoning effort override does not support minimal",
		);
	});
});
