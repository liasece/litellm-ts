<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import CodeHighlightComponent from "../../content/ui/CodeHighlightComponent.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import BudgetFormDialogComponent from "./BudgetFormDialogComponent.vue";
import { accessApi } from "../api/AccessApi";
import { createResourceStore } from "../stores/ResourceStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessBudget, AccessRecord } from "../support/AccessModels";
import { CREATE_END_USER_CURL_COMMAND, CHAT_COMPLETIONS_CURL_COMMAND, OPENAI_SDK_PYTHON_CODE } from "../support/BudgetExamples";
import "../styles/AccessStyles.css";
const store = createResourceStore(accessApi.budgets),
	{ state, rows } = store,
	money = useMoneyFormatter();
const tab = ref("budgets"),
	example = ref("assign"),
	formOpen = ref(false),
	editing = ref<AccessBudget | null>(null),
	deleting = ref<AccessBudget | null>(null),
	resetKey = ref(0);
const sorted = computed(() =>
	[...rows.value].sort((a, b) => new Date(b.updated_at ?? "").getTime() - new Date(a.updated_at ?? "").getTime()),
);
function create() {
	editing.value = null;
	formOpen.value = true;
}
function edit(value: AccessBudget) {
	editing.value = value;
	formOpen.value = true;
}
async function submit(payload: AccessRecord) {
	const item = editing.value;
	if (
		await store.run(
			() => (item ? accessApi.updateBudget(payload) : accessApi.createBudget(payload)),
			item ? "Budget Updated" : "Budget Created",
		)
	) {
		resetKey.value++;
	}
}
async function remove() {
	const item = deleting.value;
	if (item) {
		await store.run(() => accessApi.deleteBudget(item.budget_id), "Budget deleted.");
		deleting.value = null;
	}
}
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="access-budget-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><UiButton
			appearance="tremor"
			variant="primary"
			class="access-budget-create"
			@click="create"
			>+ Create Budget</UiButton
		><UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'budgets', label: 'Budgets' },
				{ key: 'examples', label: 'Examples' },
			]"
		/>
		<section v-if="tab === 'budgets'" class="access-budget-panel">
			<UiCard
				><p class="access-tremor-text">Create a budget to assign to customers.</p>
				<div class="access-budget-table-scroll">
					<table class="access-budget-table">
						<thead>
							<tr>
								<th>Budget ID</th>
								<th>Max Budget</th>
								<th>TPM</th>
								<th>RPM</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="budget in sorted" :key="budget.budget_id">
								<td>{{ budget.budget_id }}</td>
								<td>{{ budget.max_budget != null ? money(budget.max_budget) : "n/a" }}</td>
								<td>{{ budget.tpm_limit || "n/a" }}</td>
								<td>{{ budget.rpm_limit || "n/a" }}</td>
								<td class="access-budget-actions">
									<AccessActionComponent
										name="SquarePen"
										label="Edit budget"
										appearance="tremor"
										data-testid="edit-budget-button"
										@click="edit(budget)"
									/>
									<AccessActionComponent
										name="Trash2"
										label="Delete budget"
										appearance="tremor"
										data-testid="delete-budget-button"
										@click="deleting = budget"
									/>
								</td>
							</tr>
						</tbody>
					</table></div
			></UiCard>
		</section>
		<section v-else class="access-budget-panel">
			<p class="access-example-title">How to use budget id</p>
			<UiTabs
				v-model="example"
				appearance="tremor"
				:items="[
					{ key: 'assign', label: 'Assign Budget to Customer' },
					{ key: 'curl', label: 'Test it (Curl)' },
					{ key: 'sdk', label: 'Test it (OpenAI SDK)' },
				]"
			/>
			<CodeHighlightComponent
				class="access-example-code"
				:code="
					example === 'assign'
						? CREATE_END_USER_CURL_COMMAND
						: example === 'curl'
							? CHAT_COMPLETIONS_CURL_COMMAND
							: OPENAI_SDK_PYTHON_CODE
				"
				:language="example === 'sdk' ? 'python' : 'bash'"
				theme="prism"
				:token-style-overrides="{ parameter: { color: 'inherit' } }"
				:custom-style="{ fontSize: '16px' }"
			/>
		</section>
		<BudgetFormDialogComponent
			v-model:open="formOpen"
			:budget="editing"
			:pending="state.pending"
			:reset-key="resetKey"
			@submit="submit"
		/><AccessDeleteDialogComponent
			:open="Boolean(deleting)"
			title="Delete Budget?"
			message="Are you sure you want to delete this budget? This action cannot be undone."
			information-title="Budget Information"
			:information="[
				{ label: 'Budget ID', value: deleting?.budget_id, code: true },
				{ label: 'Max Budget', value: deleting?.max_budget },
				{ label: 'TPM', value: deleting?.tpm_limit },
				{ label: 'RPM', value: deleting?.rpm_limit },
			]"
			:pending="state.pending"
			@update:open="!$event && (deleting = null)"
			@confirm="remove"
		/>
	</main>
</template>
