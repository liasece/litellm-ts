<script setup lang="ts">
import { computed } from "vue";
import type { TemplateTestEntry } from "../../support/PolicyModels";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import PolicyWarningIconComponent from "../common/PolicyWarningIconComponent.vue";
const props = defineProps<{ results: TemplateTestEntry[]; collapsed: Set<string> }>();
defineEmits<{ collapse: [name: string] }>();
const counts = computed(() => {
	const results = props.results,
		blocked = results.filter((r) => r.action === "blocked").length,
		masked = results.filter((r) => r.action === "masked").length,
		passed = results.filter((r) => r.action === "passed").length;
	return [
		{ label: "Blocked", value: blocked, color: "blocked" },
		{ label: "Masked", value: masked, color: "masked" },
		{ label: "Passed", value: passed, color: "passed" },
		{ label: "Other", value: results.length - blocked - masked - passed, color: "other" },
	].filter((c) => c.value || c.label === "Passed");
});
const resultClass = (action: string) => (["blocked", "masked", "passed"].includes(action) ? action : "other");
</script>
<template>
	<div v-if="results.length" class="policy-ai-test-results">
		<div class="policy-ai-test-summary">
			<header>
				<h4>Results</h4>
				<span>{{ results.length }} guardrails tested</span>
			</header>
			<div>
				<section v-for="count in counts" :key="count.color" :class="'policy-result--' + count.color">
					<strong>{{ count.value }}</strong
					><span>{{ count.label }}</span>
				</section>
			</div>
		</div>
		<UiCard
			v-for="result in results"
			:key="result.guardrail_name"
			appearance="tremor"
			class="policy-ai-test-result"
			:class="'policy-result--' + resultClass(result.action)"
		>
			<button type="button" class="policy-ai-test-result-header" @click="$emit('collapse', result.guardrail_name)">
				<UiIcon
					:name="collapsed.has(result.guardrail_name) ? 'RightOutlined' : 'DownOutlined'"
					:size="10"
				/><PolicyWarningIconComponent v-if="result.action === 'masked'" /><UiIcon
					v-else
					:name="result.action === 'blocked' ? 'CloseCircleOutlined' : 'CheckCircleOutlined'"
					:size="14"
				/><strong>{{ result.guardrail_name }}</strong
				><span>{{ result.action.charAt(0).toUpperCase() + result.action.slice(1) }}</span>
			</button>
			<template v-if="!collapsed.has(result.guardrail_name)"
				><div v-if="result.action === 'masked' && result.output_text" class="policy-ai-result-detail">
					<label>Output Text</label>
					<pre>{{ result.output_text }}</pre>
				</div>
				<div v-if="result.action === 'blocked' && result.details" class="policy-ai-result-detail">
					<label>Details</label>
					<p>{{ result.details }}</p>
				</div>
				<p v-if="result.action === 'passed'" class="policy-ai-passed">Passed unchanged.</p></template
			></UiCard
		>
	</div>
	<p v-else class="policy-ai-test-none">No testable guardrails in selected templates.</p>
</template>
