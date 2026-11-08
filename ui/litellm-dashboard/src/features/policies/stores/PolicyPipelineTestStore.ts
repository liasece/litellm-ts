import { reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { pipelinePrompts, quickSource, matchesExpected } from "../logic/PipelineTestLogic";
import { errorText } from "../logic/PolicyLogic";
import type { GuardrailPipeline, PipelineTestResult } from "../support/PolicyModels";
import type { CompliancePrompt } from "../../playground/support/PlaygroundComplianceModels";
export interface PipelineDatasetEntry {
	prompt: CompliancePrompt;
	result: PipelineTestResult | null;
	error?: string;
	matched: boolean;
}
export function createPolicyPipelineTestStore(pipeline: () => GuardrailPipeline) {
	const state = reactive({
		source: quickSource,
		message: "Hello, can you help me?",
		running: false,
		result: null as PipelineTestResult | null,
		error: null as string | null,
		entries: [] as PipelineDatasetEntry[],
	});
	let disposed = false;
	async function run() {
		const value = pipeline(),
			currentPipeline = { mode: value.mode, steps: value.steps.map((step) => ({ ...step })) };
		if (currentPipeline.steps.some((s) => !s.guardrail)) {
			state.error = "All steps must have a guardrail selected";
			return;
		}
		state.error = null;
		state.running = true;
		state.result = null;
		state.entries = [];
		try {
			if (state.source === quickSource) {
				const result = await policiesApi.testPipeline(currentPipeline, [{ role: "user", content: state.message }]);
				if (!disposed) state.result = result;
			} else {
				const entries: PipelineDatasetEntry[] = [];
				for (const prompt of pipelinePrompts(state.source)) {
					if (disposed) return;
					try {
						const result = await policiesApi.testPipeline(currentPipeline, [{ role: "user", content: prompt.prompt }]);
						entries.push({ prompt, result, matched: matchesExpected(prompt.expectedResult, result.terminal_action) });
					} catch (error) {
						entries.push({ prompt, result: null, error: errorText(error), matched: false });
					}
				}
				if (!disposed) state.entries = entries;
			}
		} catch (error) {
			if (!disposed) state.error = errorText(error);
		} finally {
			if (!disposed) state.running = false;
		}
	}
	return {
		state,
		run,
		dispose: () => {
			disposed = true;
		},
	};
}
