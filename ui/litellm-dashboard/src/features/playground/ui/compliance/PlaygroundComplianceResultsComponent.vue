<script setup lang="ts">
import type { PlaygroundComplianceStore } from "../../stores/PlaygroundComplianceStore";
import type { ComplianceFilter } from "../../support/PlaygroundComplianceModels";
import { categoryIconNames } from "../../logic/PlaygroundComplianceLogic";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ store: PlaygroundComplianceStore }>(),
	state = props.store.state,
	filters: ComplianceFilter[] = ["all", "matches", "mismatches", "pending"];
function count(filter: ComplianceFilter) {
	return filter === "all" ? state.results.length : props.store.counts.value[filter];
}
</script>
<template>
	<div class="pg-compliance-results">
		<header>
			<div class="pg-between">
				<h2>Results</h2>
				<div v-if="state.results.length" class="pg-inline">
					<button type="button" :disabled="!store.results.value.length" @click="store.exportResults">
						<UiLucideIcon name="Download" :size="12" />Export CSV</button
					><span class="pg-green"><UiLucideIcon name="CheckCircle2" :size="12" />{{ store.counts.value.matches }}</span
					><span class="pg-amber" title="Allowed content that should have been blocked"
						><UiLucideIcon name="AlertTriangle" :size="12" />{{ store.counts.value.falseNegative }} FN</span
					><span class="pg-red" title="Blocked content that should have been allowed"
						><UiLucideIcon name="X" :size="12" />{{ store.counts.value.falsePositive }} FP</span
					><span v-if="store.counts.value.pending"><UiSpinner :size="12" />{{ store.counts.value.pending }}</span>
				</div>
			</div>
			<div v-if="state.results.length" class="pg-compliance-results__filters">
				<button
					v-for="filter in filters"
					:key="filter"
					type="button"
					:class="{ 'is-active': state.filter === filter }"
					@click="state.filter = filter"
				>
					{{ filter }} ({{ count(filter) }})
				</button>
			</div>
		</header>
		<div class="pg-compliance-results__scroll">
			<div v-if="!state.results.length" class="pg-compliance-empty">
				<span class="is-large"><UiLucideIcon name="FlaskConical" :size="24" /></span>
				<p>Select prompts and click Simulate to run batch compliance tests.</p>
			</div>
			<div v-else class="pg-compliance-results__list">
				<div v-if="store.counts.value.completed" class="pg-compliance-results__summary">
					<div>
						<span
							><strong>{{ state.results.length }}</strong> total</span
						><i></i
						><span
							><strong class="pg-green">{{ store.counts.value.matches }}</strong> correct</span
						><i></i
						><span
							><strong class="pg-amber">{{ store.counts.value.falseNegative }}</strong> false negative</span
						><i></i
						><span
							><strong class="pg-red">{{ store.counts.value.falsePositive }}</strong> false positive</span
						>
					</div>
					<div
						class="pg-compliance-results__score"
						:class="store.counts.value.score >= 80 ? 'is-pass' : store.counts.value.score >= 50 ? 'is-warning' : 'is-fail'"
					>
						<small>Score</small><strong>{{ store.counts.value.score }}%</strong>
					</div>
				</div>
				<article
					v-for="result in store.results.value"
					:key="result.promptId"
					class="pg-compliance-result"
					:class="result.status !== 'complete' ? 'is-pending' : result.isMatch ? 'is-match' : 'is-gap'"
				>
					<div class="pg-compliance-result__row">
						<UiSpinner v-if="result.status !== 'complete'" :size="14" /><UiLucideIcon
							v-else
							:name="result.isMatch ? 'CheckCircle2' : 'AlertTriangle'"
							:size="14"
							:class="result.isMatch ? 'pg-green' : 'pg-red'"
						/>
						<div>
							<p>{{ result.prompt }}</p>
							<div class="pg-compliance-result__badges">
								<span
									><UiLucideIcon :name="categoryIconNames[result.categoryIcon] || 'ClipboardList'" :size="12" />{{
										result.category
									}}</span
								><span class="pg-compliance-badge" :class="result.expectedResult === 'fail' ? 'is-fail' : 'is-pass'">{{
									result.expectedResult === "fail" ? "Expect Block" : "Expect Allow"
								}}</span
								><span
									v-if="result.status === 'complete'"
									class="pg-compliance-badge"
									:class="result.isMatch ? 'is-pass' : 'is-fail'"
									>{{ result.isMatch ? "✓ Match" : "✗ Gap" }}</span
								>
							</div>
						</div>
						<button
							v-if="result.status === 'complete'"
							type="button"
							:aria-label="state.expandedResults.has(result.promptId) ? 'Collapse' : 'Expand'"
							@click="store.toggle('expandedResults', result.promptId)"
						>
							<UiLucideIcon :name="state.expandedResults.has(result.promptId) ? 'ChevronDown' : 'ChevronRight'" :size="14" />
						</button>
					</div>
					<div
						v-if="state.expandedResults.has(result.promptId) && result.status === 'complete'"
						class="pg-compliance-result__details"
					>
						<div v-if="result.triggeredBy">
							<span>Triggered by:</span> <strong>{{ result.triggeredBy }}</strong>
						</div>
						<div>
							<span>Verdict:</span>
							<b :class="result.isMatch ? 'pg-green' : 'pg-red'">{{
								result.isMatch
									? "Correctly handled"
									: result.expectedResult === "fail"
										? "Gap — should have been blocked"
										: "False positive — incorrectly blocked"
							}}</b>
						</div>
						<div v-if="result.returnedText != null && result.returnedText !== ''">
							<span>LLM response:</span>
							<pre>{{ result.returnedText }}</pre>
						</div>
					</div>
				</article>
			</div>
		</div>
	</div>
</template>
