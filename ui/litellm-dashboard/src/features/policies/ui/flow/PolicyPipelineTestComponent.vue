<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { createPolicyPipelineTestStore } from "../../stores/PolicyPipelineTestStore";
import { pipelineTestSources, pipelinePrompts, quickSource, allSource, outcomeStyles } from "../../logic/PipelineTestLogic";
import type { GuardrailPipeline } from "../../support/PolicyModels";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyPipelineResultComponent from "./PolicyPipelineResultComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
const props = defineProps<{ pipeline: GuardrailPipeline }>(),
	emit = defineEmits<{ close: [] }>(),
	store = createPolicyPipelineTestStore(() => props.pipeline),
	state = store.state,
	prompts = computed(() => pipelinePrompts(state.source));
onBeforeUnmount(store.dispose);
</script>
<template>
	<aside class="policy-pipeline-test">
		<header><strong>Test Pipeline</strong><button type="button" aria-label="Close test panel" @click="emit('close')">x</button></header>
		<div class="policy-pipeline-input">
			<label>Test with</label><PolicySelectComponent v-model="state.source" :options="pipelineTestSources" />
			<template v-if="state.source === quickSource"
				><label>Message</label><textarea v-model="state.message" placeholder="Enter a test message..." rows="3" />
			</template>
			<div v-if="prompts.length" class="policy-pipeline-dataset-hint">
				{{
					state.source === allSource
						? "Run pipeline against all compliance prompts (EU AI Act, GDPR, Topic Blocking, Airline, etc.)."
						: "Run pipeline against " + prompts.length + ' prompts from "' + state.source + '".'
				}}
			</div>
			<UiButton variant="primary" appearance="tremor" :loading="state.running" class="policy-full-width" @click="store.run"
				>Run Test</UiButton
			>
		</div>
		<div class="policy-pipeline-results">
			<div v-if="state.error" class="policy-pipeline-error">{{ state.error }}</div>
			<PolicyPipelineResultComponent v-if="state.result" :result="state.result" />
			<div v-if="state.entries.length" class="policy-pipeline-dataset">
				<h4>Compliance dataset</h4>
				<p>{{ state.entries.filter((e) => e.matched).length }} / {{ state.entries.length }} matched expected</p>
				<div>
					<article v-for="(entry, index) in state.entries" :key="entry.prompt.id || index">
						<p :title="entry.prompt.prompt">{{ entry.prompt.prompt }}</p>
						<div>
							<span>expected: {{ entry.prompt.expectedResult }}</span
							><span class="policy-muted">→</span
							><span>actual: {{ entry.result?.terminal_action || (entry.error ? "error" : "—") }}</span
							><b :style="entry.matched ? outcomeStyles.pass : outcomeStyles.fail">{{ entry.matched ? "✓" : "✗" }}</b>
						</div>
						<div v-if="entry.error" class="policy-error-text">{{ entry.error }}</div>
					</article>
				</div>
			</div>
			<p v-if="!state.result && !state.error && !state.entries.length" class="policy-pipeline-empty">
				Choose a test source above (quick chat or a compliance dataset) and click "Run Test"
			</p>
		</div>
	</aside>
</template>
