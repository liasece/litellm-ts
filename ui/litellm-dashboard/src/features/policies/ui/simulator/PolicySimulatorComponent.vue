<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { policiesApi } from "../../api/PoliciesApi";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createPolicyScopeOptionsStore } from "../../stores/PolicyScopeOptionsStore";
import type { PolicyResolution } from "../../support/PolicyModels";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyTagInputComponent from "../common/PolicyTagInputComponent.vue";
import PolicyTagsComponent from "../common/PolicyTagsComponent.vue";
import UiFormField from "../../../platform/ui/UiFormField.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiEmptyState from "../../../platform/ui/UiEmptyState.vue";
const options = createPolicyScopeOptionsStore(useAuthenticationStore().state.session?.user_id),
	form = reactive({ team_alias: "", key_alias: "", model: "", tags: [] as string[] }),
	loading = ref(false),
	searched = ref(false),
	result = ref<PolicyResolution | null>(null);
onMounted(() => void options.load());
onBeforeUnmount(options.dispose);
async function simulate() {
	loading.value = true;
	searched.value = true;
	try {
		result.value = await policiesApi.resolve({
			team_alias: form.team_alias || undefined,
			key_alias: form.key_alias || undefined,
			model: form.model || undefined,
			tags: form.tags.length ? form.tags : undefined,
		});
	} catch {
		result.value = null;
	} finally {
		loading.value = false;
	}
}
function reset() {
	Object.assign(form, { team_alias: "", key_alias: "", model: "", tags: [] });
	result.value = null;
	searched.value = false;
}
</script>
<template>
	<div class="policy-simulator">
		<section>
			<header>
				<h3>Policy Simulator</h3>
				<p>
					Simulate a request to see which policies and guardrails would apply. Select a team, key, model, or tags below and click
					"Simulate" to see the results.
				</p>
			</header>
			<form @submit.prevent="simulate">
				<div class="policy-simulator-grid">
					<UiFormField label="Team Alias"
						><PolicySelectComponent
							v-model="form.team_alias"
							:options="options.state.teams.map((value) => ({ value, label: value }))"
							searchable
							clearable
							placeholder="Select or type a team alias"
					/></UiFormField>
					<UiFormField label="Key Alias"
						><PolicySelectComponent
							v-model="form.key_alias"
							:options="options.state.keys.map((value) => ({ value, label: value }))"
							searchable
							clearable
							placeholder="Select or type a key alias"
					/></UiFormField>
					<UiFormField label="Model"
						><PolicySelectComponent
							v-model="form.model"
							:options="options.state.models.map((value) => ({ value, label: value }))"
							searchable
							clearable
							placeholder="Select or type a model"
					/></UiFormField>
					<UiFormField label="Tags"
						><PolicyTagInputComponent v-model="form.tags" placeholder="Type a tag and press Enter" :separators="[',', ' ']"
					/></UiFormField>
				</div>
				<div class="policy-inline-actions">
					<UiButton variant="primary" appearance="tremor" :loading="loading" type="submit">Simulate</UiButton
					><UiButton appearance="tremor" variant="default" @click="reset">Reset</UiButton>
				</div>
			</form>
		</section>
		<section v-if="!searched" class="policy-simulator-empty">
			<svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
				/></svg
			><strong>No simulation run yet</strong>
			<p>Fill in one or more fields above and click "Simulate" to see which policies and guardrails would apply to that request.</p>
		</section>
		<section v-if="searched && result">
			<UiEmptyState v-if="!result.matched_policies.length" description="No policies matched this context" /><template v-else
				><div class="policy-simulator-effective">
					<strong>Effective Guardrails</strong><PolicyTagsComponent :values="result.effective_guardrails" color="green" /><span
						v-if="!result.effective_guardrails.length"
						>None</span
					>
				</div>
				<strong>Matched Policies</strong>
				<table class="policy-simulator-results">
					<thead>
						<tr>
							<th>Policy</th>
							<th>Matched Via</th>
							<th>Guardrails Added</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="policy in result.matched_policies" :key="policy.policy_name">
							<td>
								<strong>{{ policy.policy_name }}</strong>
							</td>
							<td><PolicyTagsComponent :values="[policy.matched_via]" color="blue" /></td>
							<td>
								<PolicyTagsComponent
									v-if="policy.guardrails_added.length"
									:values="policy.guardrails_added"
									color="green"
								/><span v-else class="policy-muted">None</span>
							</td>
						</tr>
					</tbody>
				</table></template
			>
		</section>
		<UiAlert v-if="searched && !result && !loading" type="error" title="Error"
			>Failed to resolve policies. Check the proxy logs.</UiAlert
		>
	</div>
</template>
