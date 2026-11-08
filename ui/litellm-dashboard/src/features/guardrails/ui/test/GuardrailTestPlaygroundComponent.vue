<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiEmpty from "../../../platform/ui/UiEmptyState.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { legacyGuardrailText } from "../../support/GuardrailClipboardSupport";
import type { GuardrailRecord } from "../../support/GuardrailModels";
import { createGuardrailTestStore } from "../../stores/GuardrailTestStore";
import GuardrailTestPanelComponent from "./GuardrailTestPanelComponent.vue";
import "../../styles/GuardrailTestStyles.css";
const props = defineProps<{ rows: GuardrailRecord[]; loading: boolean }>(),
	auth = useAuthenticationStore(),
	store = createGuardrailTestStore(() => auth.isAuthorized.value),
	{ selected, search, results, errors, pending } = store,
	filtered = computed(() => props.rows.filter((row) => row.guardrail_name?.toLowerCase().includes(search.value.toLowerCase())));
</script>
<template>
	<div class="guardrail-test-playground">
		<UiCard
			><div class="guardrail-test-layout">
				<aside>
					<header>
						<h3>Guardrails</h3>
						<UiInput v-model="search" appearance="tremor" placeholder="Search guardrails..."
							><template #prefix><UiIcon name="SearchOutlined" /></template
						></UiInput>
					</header>
					<div class="guardrail-test-selection">
						<UiSpinner v-if="loading" /><UiEmpty
							v-else-if="!filtered.length"
							:description="search ? 'No guardrails match your search' : 'No guardrails available'"
						/>
						<div
							v-for="row in filtered"
							v-else
							:key="row.guardrail_id"
							:class="['guardrail-test-choice', { selected: selected.has(row.guardrail_name || '') }]"
							@click="store.toggle(row.guardrail_name)"
						>
							<input
								type="checkbox"
								:checked="selected.has(row.guardrail_name || '')"
								:aria-label="row.guardrail_name || 'Unnamed Guardrail'"
								@click.stop="store.toggle(row.guardrail_name)"
							/>
							<div>
								<strong><UiIcon name="ExperimentOutlined" />{{ row.guardrail_name }}</strong
								><small><b>Type: </b>{{ row.litellm_params.guardrail }}</small
								><small><b>Mode: </b>{{ legacyGuardrailText(row.litellm_params.mode) }}</small>
							</div>
						</div>
					</div>
					<footer>{{ selected.size }} of {{ filtered.length }} selected</footer>
				</aside>
				<section>
					<header><h3>Guardrail Testing Playground</h3></header>
					<div>
						<div v-if="!selected.size" class="guardrail-test-placeholder">
							<UiIcon name="ExperimentOutlined" :size="48" />
							<h3>Select Guardrails to Test</h3>
							<p>Choose one or more guardrails from the left sidebar to start testing and comparing results.</p>
						</div>
						<GuardrailTestPanelComponent
							v-else
							:names="[...selected]"
							:pending="pending"
							:results="results"
							:errors="errors"
							@submit="store.test"
						/>
					</div>
				</section></div
		></UiCard>
	</div>
</template>
