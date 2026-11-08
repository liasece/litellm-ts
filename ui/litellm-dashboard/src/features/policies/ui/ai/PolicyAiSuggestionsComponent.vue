<script setup lang="ts">
import type { PolicyAiSuggestionStore } from "../../stores/PolicyAiSuggestionStore";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import type { PolicyTemplate, SuggestedTemplate } from "../../support/PolicyModels";
const props = defineProps<{ store: PolicyAiSuggestionStore; templates: PolicyTemplate[] }>(),
	state = props.store.state;
const template = (suggestion: SuggestedTemplate) => suggestion.template ?? props.templates.find((t) => t.id === suggestion.template_id);
</script>
<template>
	<div v-if="!state.suggestions?.length" class="policy-ai-no-results">
		<svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="1.5"
				d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
			/></svg
		><strong>No matching templates found</strong>
		<p>Try adjusting your examples or description.</p>
	</div>
	<div v-else class="policy-ai-suggestions">
		<template v-for="suggestion in state.suggestions" :key="suggestion.template_id"
			><article v-if="template(suggestion)" :class="{ 'is-selected': state.selected.has(suggestion.template_id) }">
				<div @click="store.toggle(suggestion.template_id)">
					<UiCheckbox :model-value="state.selected.has(suggestion.template_id)" :label="template(suggestion)?.title" />
					<section>
						<header>
							<strong>{{ template(suggestion)?.title }}</strong
							><span
								v-if="template(suggestion)?.complexity"
								class="policy-ai-pill"
								:class="'policy-complexity--' + template(suggestion)?.complexity"
								>{{ template(suggestion)?.complexity }}</span
							><UiTooltip
								v-if="template(suggestion)?.estimated_latency_ms != null"
								title="Estimated latency overhead added to each request"
								><span
									class="policy-ai-pill"
									:class="
										(template(suggestion)?.estimated_latency_ms ?? 0) <= 1
											? 'policy-ai-pill--green'
											: 'policy-ai-pill--amber'
									"
									>+{{
										(template(suggestion)?.estimated_latency_ms ?? 0) <= 1
											? "&lt;1"
											: template(suggestion)?.estimated_latency_ms
									}}ms latency</span
								></UiTooltip
							>
						</header>
						<p>{{ template(suggestion)?.description }}</p>
						<div class="policy-ai-guardrails">
							<span v-for="guardrail in template(suggestion)?.guardrails.slice(0, 4)" :key="guardrail">{{ guardrail }}</span
							><small v-if="(template(suggestion)?.guardrails.length ?? 0) > 4"
								>+{{ (template(suggestion)?.guardrails.length ?? 0) - 4 }} more</small
							>
						</div>
						<div class="policy-ai-reason">
							<UiIcon name="InfoCircleOutlined" :size="12" />
							<p>{{ suggestion.reason }}</p>
						</div>
					</section>
				</div>
			</article></template
		>
		<div v-if="state.explanation" class="policy-ai-explanation">
			<header><UiIcon name="InfoCircleOutlined" :size="12" /><strong>Why these templates</strong></header>
			<p>{{ state.explanation }}</p>
		</div>
	</div>
</template>
