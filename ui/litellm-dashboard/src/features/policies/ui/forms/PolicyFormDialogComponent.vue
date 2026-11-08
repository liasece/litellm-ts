<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import type { Policy } from "../../support/PolicyModels";
import type { GuardrailRecord } from "../../../guardrails/support/GuardrailModels";
import { createPolicySimpleFormStore } from "../../stores/PolicySimpleFormStore";
import { createPolicyScopeOptionsStore } from "../../stores/PolicyScopeOptionsStore";
import PolicyModePickerComponent from "./PolicyModePickerComponent.vue";
import PolicyConditionsComponent from "./PolicyConditionsComponent.vue";
import PolicyDividerComponent from "../common/PolicyDividerComponent.vue";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyTagsComponent from "../common/PolicyTagsComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiFormField from "../../../platform/ui/UiFormField.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ open: boolean; editing: Partial<Policy> | null; policies: Policy[]; guardrails: GuardrailRecord[] }>(),
	emit = defineEmits<{ close: []; saved: []; flow: [] }>();
const auth = useAuthenticationStore(),
	store = createPolicySimpleFormStore(() => props.policies, { saved: () => emit("saved"), close: () => emit("close") }),
	state = store.state,
	form = store.form,
	options = createPolicyScopeOptionsStore(auth.state.session?.user_id),
	guardrailOptions = computed(() =>
		props.guardrails.map((g) => ({ value: g.guardrail_name || g.guardrail_id || "", label: g.guardrail_name || g.guardrail_id || "" })),
	),
	policyOptions = computed(() =>
		props.policies.filter((p) => p.policy_id !== props.editing?.policy_id).map((p) => ({ value: p.policy_name, label: p.policy_name })),
	);
watch(
	[() => props.open, () => props.editing],
	([open]) => {
		if (open) {
			store.initialize(props.editing);
			void options.loadModels();
			if (props.editing?.pipeline) {
				emit("flow");
			}
		}
	},
	{ immediate: true },
);
onBeforeUnmount(options.dispose);
function proceed() {
	if (state.mode === "flow_builder") emit("flow");
	else state.step = "simple_form";
}
</script>
<template>
	<UiDialog
		:open="open"
		:title="editing?.policy_id ? 'Edit Policy' : 'Create New Policy'"
		:width="state.step === 'pick_mode' ? 620 : 700"
		:show-footer="false"
		scroll-mode="overlay"
		class="policy-form-dialog"
		@update:open="!$event && emit('close')"
	>
		<template v-if="state.step === 'pick_mode'"
			><PolicyModePickerComponent v-model="state.mode" /><UiAlert
				v-if="state.mode === 'flow_builder'"
				:show-icon="false"
				class="policy-mode-notice"
				>You'll be redirected to the full-screen Flow Builder to design your policy logic visually.</UiAlert
			>
			<div class="policy-form-actions policy-mode-actions">
				<UiButton appearance="tremor" variant="default" @click="emit('close')">Cancel</UiButton
				><UiButton variant="primary" appearance="tremor" class="policy-mode-continue" @click="proceed">{{
					state.mode === "flow_builder" ? "Continue to Builder" : "Create Policy"
				}}</UiButton>
			</div></template
		>
		<form v-else @submit.prevent="store.save">
			<UiFormField label="Policy Name" for="policy-name" required :error="state.nameError"
				><UiInput
					id="policy-name"
					v-model="form.policy_name"
					appearance="tremor"
					placeholder="e.g., global-baseline, healthcare-compliance"
					:disabled="!!editing?.policy_id"
			/></UiFormField>
			<UiFormField label="Description" for="policy-description"
				><UiInput
					id="policy-description"
					v-model="form.description"
					appearance="tremor"
					multiline
					:rows="2"
					placeholder="Describe what this policy does..."
			/></UiFormField>
			<PolicyDividerComponent>Inheritance</PolicyDividerComponent>
			<UiFormField label="Inherit From"
				><template #label
					>Inherit From<UiTooltip
						title="Inherit guardrails from another policy. The child policy will include all guardrails from the parent."
						><UiIcon class="policy-form-label-help" name="QuestionCircleOutlined" :size="14" /></UiTooltip></template
				><PolicySelectComponent
					v-model="form.inherit"
					:options="policyOptions"
					clearable
					placeholder="Select a parent policy (optional)"
			/></UiFormField>
			<PolicyDividerComponent>Guardrails</PolicyDividerComponent>
			<UiFormField label="Guardrails to Add"
				><template #label
					>Guardrails to Add<UiTooltip title="These guardrails will be added to requests matching this policy"
						><UiIcon class="policy-form-label-help" name="QuestionCircleOutlined" :size="14" /></UiTooltip></template
				><PolicySelectComponent
					v-model="form.guardrails_add"
					:options="guardrailOptions"
					multiple
					clearable
					placeholder="Select guardrails to add"
			/></UiFormField>
			<UiFormField label="Guardrails to Remove"
				><template #label
					>Guardrails to Remove<UiTooltip title="These guardrails will be removed from inherited guardrails"
						><UiIcon class="policy-form-label-help" name="QuestionCircleOutlined" :size="14" /></UiTooltip></template
				><PolicySelectComponent
					v-model="form.guardrails_remove"
					:options="guardrailOptions"
					multiple
					clearable
					placeholder="Select guardrails to remove (from inherited)"
			/></UiFormField>
			<UiAlert v-if="store.resolved.value.length" title="Resolved Guardrails" class="policy-mb16"
				><p class="policy-secondary policy-mb8">These are the final guardrails that will be applied (including inheritance):</p>
				<PolicyTagsComponent :values="store.resolved.value" color="blue"
			/></UiAlert>
			<PolicyDividerComponent>Conditions (Optional)</PolicyDividerComponent>
			<PolicyConditionsComponent
				v-model:condition-type="state.conditionType"
				:form="form"
				:models="options.state.models"
				@condition="form.model_condition = $event"
			/>
			<div class="policy-form-actions">
				<UiButton appearance="tremor" variant="default" @click="emit('close')">Cancel</UiButton
				><UiButton variant="primary" appearance="tremor" type="submit" :loading="state.submitting">{{
					editing?.policy_id ? "Update Policy" : "Create Policy"
				}}</UiButton>
			</div>
		</form></UiDialog
	>
</template>
