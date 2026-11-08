<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UsageChart from "../../ui/charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import type { createLegacyUsageStore } from "../stores/LegacyUsageStore";
const props = defineProps<{ data: ReturnType<typeof createLegacyUsageStore>["state"] }>(),
	money = useMoneyFormatter();
const teams = computed(() => [...props.data.teamTotals].sort((a, b) => b.value - a.value));
const max = computed(() => Math.max(...teams.value.map((row) => row.value), 0));
</script>
<template>
	<div class="legacy-team-grid">
		<div class="legacy-span2">
			<UiCard appearance="tremor" class="legacy-team-totals"
				><h3>Total Spend Per Team</h3>
				<div class="legacy-bar-list" aria-sort="descending">
					<div class="legacy-bar-list__bars">
						<div v-for="(row, index) in teams" :key="index">
							<div
								class="legacy-bar-list__bar"
								:style="{ width: (row.value === 0 ? 0 : Math.max(max ? (row.value / max) * 100 : 0, 2)) + '%' }"
							>
								<div>
									<p>{{ row.name }}</p>
								</div>
							</div>
						</div>
					</div>
					<div class="legacy-bar-list__labels">
						<div v-for="(row, index) in teams" :key="index">
							<p>{{ money(row.value, 2) }}</p>
						</div>
					</div>
				</div></UiCard
			><UiCard appearance="tremor"
				><h3>Daily Spend Per Team</h3>
				<UsageChart
					:data="data.teams"
					index="date"
					:categories="data.teamNames"
					:colors="['blue']"
					:height="288"
					:y-axis-width="80"
					legend
					:legend-height="42"
					stack
					:format="(value) => money(value, 2)"
			/></UiCard>
		</div>
		<div class="legacy-span2" />
	</div>
</template>
