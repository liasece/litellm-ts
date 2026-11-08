<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import type { Policy } from "../../support/PolicyModels";
import { policiesApi } from "../../api/PoliciesApi";
import { policyDate } from "../../logic/PolicyLogic";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import PolicyDividerComponent from "../common/PolicyDividerComponent.vue";
import PolicyTagsComponent from "../common/PolicyTagsComponent.vue";
import PolicyBadgeComponent from "../common/PolicyBadgeComponent.vue";
import PolicyFlowCanvasComponent from "../flow/PolicyFlowCanvasComponent.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
const props = defineProps<{ policyId: string; isAdmin: boolean }>(),
	emit = defineEmits<{ close: []; edit: [policy: Policy] }>(),
	policy = ref<Policy | null>(null),
	loading = ref(true),
	resolved = ref<string[]>([]);
let generation = 0;
const controller = new AbortController();
watch(
	() => props.policyId,
	async (id) => {
		const current = ++generation;
		loading.value = true;
		try {
			const result = await policiesApi.detail(id, controller.signal);
			if (current !== generation) return;
			policy.value = result;
			try {
				const names = await policiesApi.resolved(id, controller.signal);
				if (current === generation) resolved.value = names;
			} catch {
				if (current === generation) resolved.value = [];
			}
		} catch {
			if (current === generation) policy.value = null;
		} finally {
			if (current === generation) loading.value = false;
		}
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	generation++;
	controller.abort();
});
</script>
<template>
	<div v-if="loading" class="policy-info-loading"><UiSpinner :size="32" /></div>
	<UiCard v-else-if="!policy" appearance="tremor"
		><span class="policy-error-text">Policy not found</span><br /><UiButton
			variant="primary"
			appearance="tremor"
			class="policy-mt16"
			@click="emit('close')"
			>Go Back</UiButton
		></UiCard
	>
	<UiCard v-else appearance="tremor" class="policy-info"
		><div>
			<header>
				<UiButton appearance="tremor" variant="default" @click="emit('close')"
					><template #icon><PolicyHeroIconComponent name="ArrowLeft" :size="20" /></template>Back to Policies</UiButton
				><UiButton variant="primary" v-if="isAdmin" appearance="tremor" @click="emit('edit', policy)"
					><template #icon><PolicyHeroIconComponent name="Pencil" :size="20" /></template>Edit Policy</UiButton
				>
			</header>
			<h4>{{ policy.policy_name }}</h4>
			<table class="policy-descriptions">
				<tbody>
					<tr>
						<th scope="row">Policy ID</th>
						<td>
							<code>{{ policy.policy_id }}</code>
						</td>
					</tr>
					<tr>
						<th scope="row">Description</th>
						<td :class="{ 'policy-secondary': !policy.description }">{{ policy.description || "No description" }}</td>
					</tr>
					<tr>
						<th scope="row">Inherits From</th>
						<td>
							<PolicyBadgeComponent v-if="policy.inherit">{{ policy.inherit }}</PolicyBadgeComponent
							><span v-else class="policy-secondary">None</span>
						</td>
					</tr>
					<tr>
						<th scope="row">Created At</th>
						<td>{{ policyDate(policy.created_at) }}</td>
					</tr>
					<tr>
						<th scope="row">Updated At</th>
						<td>{{ policyDate(policy.updated_at) }}</td>
					</tr>
				</tbody>
			</table>
			<template v-if="policy.pipeline"
				><PolicyDividerComponent>Pipeline Flow</PolicyDividerComponent
				><UiAlert
					:title="
						'Pipeline (' +
						policy.pipeline.mode +
						' mode, ' +
						policy.pipeline.steps.length +
						' step' +
						(policy.pipeline.steps.length !== 1 ? 's' : '') +
						')'
					"
					class="policy-mb16" /><PolicyFlowCanvasComponent :model-value="policy.pipeline" readonly
			/></template>
			<PolicyDividerComponent>Guardrails Configuration</PolicyDividerComponent
			><UiAlert v-if="resolved.length" title="Resolved Guardrails" class="policy-mb16"
				><p class="policy-secondary policy-mb8">Final guardrails that will be applied (including inheritance):</p>
				<PolicyTagsComponent :values="resolved" color="blue"
			/></UiAlert>
			<table class="policy-descriptions">
				<tbody>
					<tr>
						<th scope="row">Guardrails to Add</th>
						<td>
							<PolicyTagsComponent v-if="policy.guardrails_add.length" :values="policy.guardrails_add" color="green" /><span
								v-else
								class="policy-secondary"
								>None</span
							>
						</td>
					</tr>
					<tr>
						<th scope="row">Guardrails to Remove</th>
						<td>
							<PolicyTagsComponent
								v-if="policy.guardrails_remove.length"
								:values="policy.guardrails_remove"
								color="red"
							/><span v-else class="policy-secondary">None</span>
						</td>
					</tr>
				</tbody>
			</table>
			<PolicyDividerComponent>Conditions</PolicyDividerComponent>
			<table class="policy-descriptions">
				<tbody>
					<tr>
						<th scope="row">Model Condition</th>
						<td>
							<UiTag v-if="policy.condition?.model" color="purple">{{
								typeof policy.condition.model === "string" ? policy.condition.model : JSON.stringify(policy.condition.model)
							}}</UiTag
							><span v-else class="policy-secondary">No model condition (applies to all models)</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div></UiCard
	>
</template>
