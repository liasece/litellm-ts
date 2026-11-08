<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import type { AccessBudget, AccessRecord } from "../support/AccessModels";
const props = defineProps<{ open: boolean; budget?: AccessBudget | null; pending?: boolean; resetKey?: number }>();
const emit = defineEmits<{ "update:open": [open: boolean]; submit: [payload: AccessRecord] }>();
const draft = reactive({
	budget_id: "",
	max_budget: null as number | null,
	tpm_limit: null as number | null,
	rpm_limit: null as number | null,
	budget_duration: null as string | null,
});
const error = ref("");
function reset() {
	Object.assign(draft, {
		budget_id: props.budget?.budget_id ?? "",
		max_budget: props.budget?.max_budget == null ? null : Number(props.budget.max_budget),
		tpm_limit: props.budget?.tpm_limit ?? null,
		rpm_limit: props.budget?.rpm_limit ?? null,
		budget_duration: props.budget?.budget_duration ?? null,
	});
	error.value = "";
}
watch(() => [props.open, props.budget, props.resetKey], reset);
function submit() {
	error.value = draft.budget_id ? "" : "Please input a human-friendly name for the budget";
	if (!error.value) emit("submit", { ...draft });
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="open"
		class="access-budget-dialog"
		:title="budget ? 'Edit Budget' : 'Create Budget'"
		:width="800"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><form class="access-horizontal-form" @submit.prevent="submit">
			<AccessFieldComponent
				v-model="draft.budget_id"
				name="budget-id"
				label="Budget ID"
				required
				horizontal
				input-appearance="tremor"
				help="A human-friendly name for the budget"
				:error="error"
			/><AccessFieldComponent
				v-model="draft.tpm_limit"
				name="budget-tpm"
				label="Max Tokens per minute"
				type="number"
				horizontal
				help="Default is model limit."
			/><AccessFieldComponent
				v-model="draft.rpm_limit"
				name="budget-rpm"
				label="Max Requests per minute"
				type="number"
				horizontal
				help="Default is model limit."
			/>
			<details class="access-tremor-accordion access-budget-optional">
				<summary><b>Optional Settings</b></summary>
				<div>
					<AccessFieldComponent
						v-model="draft.max_budget"
						name="budget-max"
						label="Max Budget (USD)"
						type="number"
						:step="0.01"
						horizontal
					/><AccessFieldComponent
						v-model="draft.budget_duration"
						name="budget-duration"
						label="Reset Budget"
						type="select"
						:options="[
							{ value: '24h', label: 'daily' },
							{ value: '7d', label: 'weekly' },
							{ value: '30d', label: 'monthly' },
						]"
						placeholder="n/a"
						horizontal
					/>
				</div>
			</details>
			<footer class="access-form-footer">
				<UiButton type="submit" :loading="pending">{{ budget ? "Save" : "Create Budget" }}</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
