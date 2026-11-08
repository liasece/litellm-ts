import { reactive } from "vue";
import { CODE_TEMPLATES } from "../data/GuardrailCustomCodeData";
import { TEST_INPUT_EXAMPLES } from "../data/GuardrailCustomCodeExamples";
import { guardrailsApi } from "../api/GuardrailsApi";
import { guardrailExecutionApi } from "../api/GuardrailExecutionApi";
import { normalizeGuardrailModes, guardrailTestInputType, customGuardrailPayload } from "../logic/GuardrailCustomCodeLogic";
import { guardrailRecord } from "../support/GuardrailClipboardSupport";
import type { GuardrailRecord } from "../support/GuardrailModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createGuardrailCustomCodeStore(authorized: () => boolean, api = guardrailsApi, execution = guardrailExecutionApi) {
	const state = reactive({
		name: "",
		mode: ["pre_call"],
		defaultOn: false,
		template: "empty",
		code: CODE_TEMPLATES.empty.code,
		saving: false,
		testing: false,
		testExpanded: false,
		testInput: JSON.stringify(TEST_INPUT_EXAMPLES.pre_call.data, null, 2),
		testResult: null as Record<string, unknown> | null,
	});
	function initialize(edit?: GuardrailRecord | null) {
		state.name = edit?.guardrail_name || "";
		state.mode = normalizeGuardrailModes(edit?.litellm_params.mode);
		state.defaultOn = edit?.litellm_params.default_on || false;
		state.template = edit ? "" : "empty";
		state.code = String(edit?.litellm_params.custom_code || CODE_TEMPLATES.empty.code);
		state.testResult = null;
		state.testExpanded = false;
	}
	function template(value: string) {
		if (Object.hasOwn(CODE_TEMPLATES, value)) {
			state.template = value;
			state.code = CODE_TEMPLATES[value as keyof typeof CODE_TEMPLATES].code;
		}
	}
	async function save(edit?: GuardrailRecord | null) {
		if (!state.name.trim()) {
			notificationManager.fromBackend("Please enter a guardrail name");
			return false;
		}
		if (!state.code.trim()) {
			notificationManager.fromBackend("Please enter custom code");
			return false;
		}
		if (!authorized()) {
			notificationManager.fromBackend("No access token available");
			return false;
		}
		state.saving = true;
		try {
			const body = customGuardrailPayload(state.name, state.code, state.mode, state.defaultOn, edit);
			if (edit?.guardrail_id) await api.update(edit.guardrail_id, body);
			else await api.create(body);
			notificationManager.success("Custom code guardrail " + (edit ? "updated" : "created") + " successfully");
			return true;
		} catch (error) {
			notificationManager.fromBackend(
				"Failed to " + (edit ? "update" : "create") + " guardrail: " + (error instanceof Error ? error.message : String(error)),
			);
			return false;
		} finally {
			state.saving = false;
		}
	}
	async function test() {
		if (!authorized()) {
			state.testResult = { error: "No access token available" };
			return;
		}
		state.testing = true;
		state.testResult = null;
		try {
			let parsed: unknown;
			try {
				parsed = JSON.parse(state.testInput) as unknown;
			} catch {
				state.testResult = { error: "Invalid test input JSON" };
				return;
			}
			const input = parsed as Record<string, unknown>;
			if (!input.texts) input.texts = [];
			const response = await execution.custom({
				custom_code: state.code,
				test_input: input,
				input_type: guardrailTestInputType(state.mode),
				request_data: { model: "test-model", metadata: {} },
			});
			state.testResult =
				response.success && response.result
					? guardrailRecord(response.result)
					: response.error
						? { error: response.error, error_type: response.error_type }
						: { error: "Unknown error occurred" };
		} catch (error) {
			state.testResult = { error: error instanceof Error ? error.message : String(error) };
		} finally {
			state.testing = false;
		}
	}
	return { state, initialize, template, save, test };
}
