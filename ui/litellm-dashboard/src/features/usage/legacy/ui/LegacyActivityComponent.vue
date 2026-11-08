<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UsageChart from "../../ui/charts/UsageChartComponent.vue";
import { legacyRows, compactLegacyNumber } from "../logic/LegacyUsageDataLogic";
import { formatNumberWithCommas } from "../../../formatting/logic/NumberFormattingLogic";
import type { createLegacyUsageStore } from "../stores/LegacyUsageStore";
const props = defineProps<{ data: ReturnType<typeof createLegacyUsageStore>["state"] }>();
const groups = computed(() => [{ model: "All Up", ...props.data.activity }, ...props.data.modelActivity]);
const token = (value: number) => formatNumberWithCommas(value, 0, false);
</script>
<template>
	<div class="legacy-activity-grid">
		<UiCard v-for="(group, index) in groups" :key="index" appearance="tremor"
			><h3>{{ group.model }}</h3>
			<div class="legacy-two-columns">
				<div>
					<h4>API Requests {{ compactLegacyNumber(Number(group.sum_api_requests)) }}</h4>
					<UsageChart
						:data="legacyRows(group.daily_data)"
						index="date"
						:categories="['api_requests']"
						:colors="['cyan']"
						:height="160"
						kind="area"
						legend
						:legend-height="42"
						:format="compactLegacyNumber"
					/>
				</div>
				<div>
					<h4>Tokens {{ token(Number(group.sum_total_tokens)) }}</h4>
					<UsageChart
						:data="legacyRows(group.daily_data)"
						index="date"
						:categories="['total_tokens']"
						:colors="['cyan']"
						:height="160"
						legend
						:legend-height="42"
						:format="token"
					/>
				</div></div
		></UiCard>
	</div>
</template>
