<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { PlaygroundAuth } from "../../support/PlaygroundModels";
import type { UiValue } from "../../../platform/ui/UiTypes";
import { createPlaygroundComplianceStore } from "../../stores/PlaygroundComplianceStore";
import { policyOptions, guardrailOptions } from "../../logic/PlaygroundOptionsLogic";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PlaygroundComplianceLibraryComponent from "./PlaygroundComplianceLibraryComponent.vue";
import PlaygroundComplianceQuickComponent from "./PlaygroundComplianceQuickComponent.vue";
import PlaygroundComplianceResultsComponent from "./PlaygroundComplianceResultsComponent.vue";
import "./PlaygroundComplianceStyles.css";
import "./PlaygroundComplianceLibraryStyles.css";
import "./PlaygroundComplianceResultsStyles.css";
const props = withDefaults(
		defineProps<{
			backendMode?: "policies" | "chat_completions";
			fixedModel?: string;
			inferenceAuth?: PlaygroundAuth;
			baseUrl?: string;
		}>(),
		{ backendMode: "policies", fixedModel: undefined, inferenceAuth: undefined, baseUrl: undefined },
	),
	auth = useAuthenticationStore(),
	disabled = computed(
		() =>
			Boolean(auth.state.session?.disabled_non_admin_personal_key_creation) &&
			!["Admin", "Admin Viewer"].includes(auth.userRole.value),
	),
	store = createPlaygroundComplianceStore({
		backendMode: props.backendMode,
		fixedModel: () => props.fixedModel,
		auth: () => props.inferenceAuth ?? { kind: "session" },
		baseUrl: () => props.baseUrl,
	}),
	state = store.state,
	guardrailsOpen = ref(false),
	options = computed(() => guardrailOptions(store.catalog.state.guardrails));
function array(value: UiValue | UiValue[] | null) {
	return value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}
function toggle(id: string) {
	state.guardrails = state.guardrails.includes(id) ? state.guardrails.filter((value) => value !== id) : [...state.guardrails, id];
}
onMounted(() => void store.catalog.load());
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div class="pg-compliance">
		<div class="pg-compliance__card">
			<header class="pg-compliance-config">
				<div>
					<h3>Test Configuration</h3>
					<p>Select policies, guardrails, or both to test against.</p>
				</div>
				<div class="pg-compliance-config__row">
					<div class="pg-compliance-config__field">
						<label>Policies</label
						><UiSelect
							:model-value="state.policies"
							multiple
							searchable
							clearable
							:options="policyOptions(store.catalog.state.policies)"
							placeholder="Select policies (production or published versions)"
							@update:model-value="state.policies = array($event)"
						/>
					</div>
					<div class="pg-compliance-config__or"><i></i><span>or</span><i></i></div>
					<div class="pg-compliance-config__field">
						<label>Guardrails</label>
						<div class="pg-compliance-guardrails">
							<button type="button" :aria-expanded="guardrailsOpen" @click="guardrailsOpen = !guardrailsOpen">
								<span :class="{ 'pg-muted': !state.guardrails.length }">{{
									state.guardrails.length ? state.guardrails.length + " selected" : "None selected"
								}}</span
								><UiLucideIcon name="ChevronDown" :size="16" />
							</button>
							<div v-if="guardrailsOpen" class="pg-compliance-guardrails__dropdown">
								<p v-if="!options.length">No guardrails available. Create guardrails in the Guardrails page.</p>
								<button v-for="option in options" :key="option.value" type="button" @click="toggle(String(option.value))">
									<span
										class="pg-compliance-guardrails__check"
										:class="{ 'is-checked': state.guardrails.includes(String(option.value)) }"
										><UiLucideIcon
											v-if="state.guardrails.includes(String(option.value))"
											name="Check"
											:size="12" /></span
									><span>{{ option.label }}<small>litellm_content_filter</small></span>
								</button>
							</div>
						</div>
						<div v-if="state.guardrails.length" class="pg-compliance-guardrails__selected">
							<span v-for="id in state.guardrails" :key="id"
								>{{ id
								}}<button type="button" aria-label="Remove" @click="toggle(id)"><UiLucideIcon name="X" :size="10" /></button
							></span>
						</div>
					</div>
					<div class="pg-compliance-config__actions">
						<button v-if="state.running" type="button" class="pg-compliance-primary is-stop" @click="store.stop">
							<UiLucideIcon name="Square" :size="14" />Stop</button
						><button
							v-else
							type="button"
							class="pg-compliance-primary"
							:disabled="!state.selected.size || disabled"
							@click="store.run"
						>
							<UiLucideIcon name="Play" :size="14" />Simulate ({{ state.selected.size }})</button
						><small v-if="state.running"><UiSpinner :size="12" />Running...</small
						><button type="button" @click="store.reset"><UiLucideIcon name="RotateCcw" :size="12" />Reset</button>
					</div>
				</div>
			</header>
			<div class="pg-compliance__panels">
				<PlaygroundComplianceLibraryComponent :store="store" />
				<main class="pg-compliance__right">
					<nav>
						<button
							type="button"
							:class="{ 'is-active': state.rightTab === 'quick-test' }"
							@click="state.rightTab = 'quick-test'"
						>
							<UiLucideIcon name="MessageSquare" :size="14" />Quick Test</button
						><button
							type="button"
							:class="{ 'is-active': state.rightTab === 'batch-results' }"
							@click="state.rightTab = 'batch-results'"
						>
							<UiLucideIcon name="ListChecks" :size="14" />Batch Results<span v-if="state.results.length">{{
								state.results.length
							}}</span>
						</button>
					</nav>
					<PlaygroundComplianceQuickComponent
						v-if="state.rightTab === 'quick-test'"
						:store="store"
						:disabled="disabled"
					/><PlaygroundComplianceResultsComponent v-else :store="store" />
				</main>
			</div>
		</div>
	</div>
</template>
