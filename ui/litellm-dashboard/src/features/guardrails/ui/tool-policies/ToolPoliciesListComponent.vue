<script setup lang="ts">
import { computed, watch, onBeforeUnmount, nextTick } from "vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import FilterBarComponent from "../../../filters/ui/FilterBarComponent.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createToolPoliciesStore } from "../../stores/ToolPoliciesStore";
import { inputPolicyOptions, outputPolicyOptions } from "../../data/ToolPolicyOptions";
import MonitorMetricCardComponent from "../monitor/MonitorMetricCardComponent.vue";
import ToolPolicyTableComponent from "./ToolPolicyTableComponent.vue";
import ToolPolicyPaginationComponent from "./ToolPolicyPaginationComponent.vue";
const emit = defineEmits<{ select: [name: string] }>(),
	auth = useAuthenticationStore(),
	store = createToolPoliciesStore(() => auth.isAuthorized.value),
	{ state, tools, metrics, filtered, sorted, totalPages, pageRows } = store;
const options = computed(() => [
	{ name: "Input Policy", label: "Input Policy", options: inputPolicyOptions.map((row) => ({ label: row.label, value: row.value })) },
	{ name: "Output Policy", label: "Output Policy", options: outputPolicyOptions.map((row) => ({ label: row.label, value: row.value })) },
	{
		name: "Team Name",
		label: "Team Name",
		options: [...new Set(tools.value.flatMap((row) => (row.team_id ? [row.team_id] : [])))].map((value) => ({ value, label: value })),
	},
	{
		name: "Key Name",
		label: "Key Name",
		options: [...new Set(tools.value.flatMap((row) => (row.key_alias ? [row.key_alias] : [])))].map((value) => ({
			value,
			label: value,
		})),
	},
]);
watch(auth.isAuthorized, () => void store.load(), { immediate: true });
const timers = new Set<ReturnType<typeof setTimeout>>();
let disposed = false;
async function review(id: string) {
	const index = sorted.value.findIndex((tool) => tool.tool_id === id);
	if (index < 0) return;
	state.page = Math.floor(index / 50) + 1;
	await nextTick();
	requestAnimationFrame(() => {
		if (disposed) return;
		const timer = setTimeout(() => {
			if (!disposed) document.getElementById("tool-row-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" });
			timers.delete(timer);
		}, 100);
		timers.add(timer);
	});
}
function search(event: Event) {
	store.search((event.target as HTMLInputElement).value);
}
onBeforeUnmount(() => {
	disposed = true;
	store.dispose();
	for (const timer of timers) clearTimeout(timer);
});
</script>
<template>
	<div class="tool-policies-list">
		<h1>Tool Policies</h1>
		<div class="tool-policy-metrics">
			<MonitorMetricCardComponent label="New Today" :value="metrics.newToday" color="green" :subtitle="metrics.trendSubtitle"
				><template #icon
					><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #22c55e">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
						/></svg></template></MonitorMetricCardComponent
			><MonitorMetricCardComponent label="Total Tools Discovered" :value="metrics.totalTools" /><MonitorMetricCardComponent
				label="Blocked Tools"
				:value="metrics.blockedCount"
				:color="metrics.blockedCount > 0 ? 'red' : 'default'"
			/><MonitorMetricCardComponent label="Active Teams" :value="metrics.activeTeamsCount > 0 ? metrics.activeTeamsCount : '—'" />
		</div>
		<section v-if="metrics.needsReviewTools.length" class="tool-needs-review">
			<h2>Needs Review</h2>
			<p>
				{{ metrics.needsReviewTools.length }} new tool{{ metrics.needsReviewTools.length !== 1 ? "s" : "" }} discovered that require
				policy decisions.
			</p>
			<div>
				<span v-for="tool in metrics.needsReviewTools" :key="tool.tool_id"
					><span :title="tool.tool_name">{{ tool.tool_name }}</span
					><button type="button" @click="review(tool.tool_id)">Review</button></span
				>
			</div>
		</section>
		<div class="tool-policies-card">
			<header>
				<div>
					<div class="tool-policy-fetch-controls">
						<div class="tool-policy-search">
							<input :value="state.search" placeholder="Search by Tool Name" @input="search" /><svg
								width="16"
								height="16"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
						</div>
						<label>Live Tail<UiSwitch v-model="state.liveTail" /></label
						><button type="button" :disabled="state.fetching" @click="store.load">
							<svg
								width="16"
								height="16"
								:class="{ spinning: state.fetching }"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/></svg
							>{{ state.fetching ? "Fetching" : "Fetch" }}
						</button>
					</div>
					<ToolPolicyPaginationComponent
						:page="state.page"
						:total-pages="totalPages"
						:total="filtered.length"
						@change="state.page = $event"
					/>
				</div>
				<div><FilterBarComponent :options="options" :values="state.filters" @apply="store.apply" @reset="store.apply({})" /></div>
			</header>
			<div v-if="state.liveTail" class="tool-live-tail">
				<span>Auto-refreshing every 15 seconds</span><button type="button" @click="state.liveTail = false">Stop</button>
			</div>
			<div v-if="state.error" class="tool-policy-error">{{ state.error }}</div>
			<ToolPolicyTableComponent
				:rows="pageRows"
				:loading="state.loading"
				:sort-field="state.sortField"
				:sort-order="state.sortOrder"
				:saving-input="state.savingInput"
				:saving-output="state.savingOutput"
				@select="emit('select', $event)"
				@policy="store.policy"
				@sort="store.sort"
			/><ToolPolicyPaginationComponent
				v-if="totalPages > 1"
				:page="state.page"
				:total-pages="totalPages"
				:total="sorted.length"
				compact
				@change="state.page = $event"
			/>
		</div>
	</div>
</template>
