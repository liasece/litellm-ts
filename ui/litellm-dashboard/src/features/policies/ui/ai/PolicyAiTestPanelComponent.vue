<script setup lang="ts">
import type { PolicyAiSuggestionStore } from "../../stores/PolicyAiSuggestionStore";
import PolicyAiTestResultsComponent from "./PolicyAiTestResultsComponent.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PolicyWarningIconComponent from "../common/PolicyWarningIconComponent.vue";
const props = defineProps<{ store: PolicyAiSuggestionStore }>(),
	state = props.store.state;
function close() {
	state.showTest = false;
	state.testResults = null;
	state.overallAction = null;
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
		event.preventDefault();
		void props.store.test();
	}
}
</script>
<template>
	<div class="policy-ai-test-panel">
		<header>
			<div>
				<h3>Test Guardrails</h3>
				<button type="button" aria-label="Close guardrail test" @click="close">
					<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="policy-ai-selected-titles">
				<span v-for="template in store.selectedTemplates.value" :key="template.id">{{ template.title }}</span>
			</div>
			<p>
				{{ store.definitions.value.length }} guardrails across {{ state.selected.size }} template{{
					state.selected.size !== 1 ? "s" : ""
				}}
			</p>
		</header>
		<div v-if="store.needsEnrichment.value" class="policy-ai-enrichment" :class="{ 'is-enriched': store.hasEnriched.value }">
			<header>
				<UiIcon v-if="store.hasEnriched.value" name="CheckCircleOutlined" :size="14" /><PolicyWarningIconComponent
					v-else
					class="policy-ai-warning-fixed"
				/><strong>Competitor template requires your brand name to discover competitors</strong>
			</header>
			<div class="policy-inline-actions">
				<input
					v-model="state.brandName"
					type="text"
					class="policy-ai-brand-input"
					placeholder="e.g. Emirates Airlines"
					@keydown.enter="state.brandName.trim() && store.enrich()"
				/><UiButton
					variant="primary"
					appearance="tremor"
					size="small"
					:loading="state.enriching"
					:disabled="!state.brandName.trim() || state.enriching"
					@click="store.enrich"
					>{{ state.enriching ? "Discovering..." : store.hasEnriched.value ? "Re-discover" : "Discover" }}</UiButton
				>
			</div>
			<div v-if="state.enriching && state.enrichStatus" class="policy-enrichment-status">
				<UiSpinner :size="14" />{{ state.enrichStatus }}
			</div>
			<p v-if="store.hasEnriched.value" class="policy-ai-enriched">
				<UiIcon name="CheckCircleOutlined" :size="14" />Competitor names loaded for {{ state.brandName }}
			</p>
		</div>
		<div v-if="store.needsEnrichment.value && store.generatedCompetitors.value.length" class="policy-ai-generated">
			<strong>Generated Competitors ({{ store.generatedCompetitors.value.length }})</strong>
			<div>
				<span v-for="name in store.generatedCompetitors.value" :key="name">{{ name }}</span>
			</div>
		</div>
		<div class="policy-ai-test-input">
			<header>
				<div>
					<label>Input Text</label
					><UiTooltip title="Press Enter to submit. Use Shift+Enter for new line."
						><UiIcon name="InfoCircleOutlined" :size="14"
					/></UiTooltip>
				</div>
				<span>Characters: {{ state.testInput.length }}</span>
			</header>
			<UiInput
				v-model="state.testInput"
				multiline
				:rows="4"
				class="policy-mono"
				placeholder="Enter text to test against all selected policy guardrails..."
				@keydown="key"
			/>
			<div class="policy-ai-test-hint">
				<span>Press <kbd>Enter</kbd> to submit</span>
			</div>
			<UiButton
				variant="primary"
				appearance="tremor"
				class="policy-full-width"
				:loading="state.testing"
				:disabled="!state.testInput.trim() || state.testing"
				@click="store.test"
				>{{
					state.testing
						? "Testing " + store.definitions.value.length + " guardrails..."
						: "Test " + store.definitions.value.length + " guardrails"
				}}</UiButton
			>
		</div>
		<PolicyAiTestResultsComponent
			v-if="state.testResults"
			:results="state.testResults"
			:collapsed="state.collapsed"
			@collapse="store.collapse"
		/>
	</div>
</template>
