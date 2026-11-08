import { computed, reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { resolvedGuardrails, simplePolicyData, errorText } from "../logic/PolicyLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { Policy, PolicySimpleForm } from "../support/PolicyModels";
export function createPolicySimpleFormStore(policies: () => Policy[], callbacks: { saved: () => void; close: () => void }) {
	const form = reactive<PolicySimpleForm>({
		policy_name: "",
		description: "",
		inherit: "",
		guardrails_add: [],
		guardrails_remove: [],
		model_condition: "",
	});
	const state = reactive({
		step: "pick_mode",
		mode: "simple",
		conditionType: "model",
		submitting: false,
		nameError: "",
		editing: null as Partial<Policy> | null,
		resolved: [] as string[],
	});
	const resolved = computed(() => resolvedGuardrails(policies(), form.inherit, form.guardrails_add, form.guardrails_remove));
	function initialize(policy: Partial<Policy> | null) {
		state.editing = policy;
		state.nameError = "";
		state.conditionType = "model";
		state.mode = "simple";
		state.step = policy ? "simple_form" : "pick_mode";
		const model = policy?.condition?.model;
		Object.assign(form, {
			policy_name: policy?.policy_name || "",
			description: policy?.description || "",
			inherit: policy?.inherit || "",
			guardrails_add: [...(policy?.guardrails_add || [])],
			guardrails_remove: [...(policy?.guardrails_remove || [])],
			model_condition: typeof model === "string" ? model : "",
		});
		if (typeof model === "string" && /[.*+?^$()|[\]\\{}]/.test(model)) state.conditionType = "regex";
	}
	async function save() {
		state.nameError = !form.policy_name
			? "Please enter a policy name"
			: !/^[a-zA-Z0-9_-]+$/.test(form.policy_name)
				? "Policy name can only contain letters, numbers, hyphens, and underscores"
				: "";
		if (state.nameError) return false;
		state.submitting = true;
		try {
			const id = state.editing?.policy_id,
				body = simplePolicyData(form);
			if (id) await policiesApi.update(id, body);
			else await policiesApi.create(body);
			notificationManager.success(id ? "Policy updated successfully" : "Policy created successfully");
			callbacks.saved();
			callbacks.close();
			return true;
		} catch (error) {
			notificationManager.fromBackend("Failed to save policy: " + errorText(error));
			return false;
		} finally {
			state.submitting = false;
		}
	}
	return { form, state, resolved, initialize, save };
}
