<script setup lang="ts">
import UiCard from "../../../platform/ui/UiCard.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import TremorDateRangePicker from "../../../date-range/ui/TremorDateRangePickerComponent.vue";
import UsageChart from "../../ui/charts/UsageChartComponent.vue";
import type { DateRangeValue } from "../../../date-range/support/DateRangeModels";
import type { LegacyRow } from "../api/LegacyUsageApi";
defineProps<{ rows: LegacyRow[]; names: string[]; premium: boolean }>();
const range = defineModel<DateRangeValue>("range", { required: true }),
	selected = defineModel<string[]>("tags", { required: true });
</script>
<template>
	<div class="legacy-tag-usage">
		<div class="legacy-two-columns">
			<div><TremorDateRangePicker v-model="range" class="legacy-tag-range" /></div>
			<div>
				<UiSelect
					v-model="selected"
					:options="[
						{ value: 'all-tags', label: 'All Tags' },
						...names
							.filter((name) => name !== 'all-tags')
							.map((name) => ({
								value: name,
								label: premium ? name : '✨ ' + name + ' (Enterprise only Feature)',
								disabled: !premium,
							})),
					]"
					appearance="tremor"
					multiple
					clearable
					aria-label="Filter usage tags"
				/>
			</div>
		</div>
		<div class="legacy-tag-grid">
			<div class="legacy-span2">
				<UiCard appearance="tremor"
					><h3>Spend Per Tag</h3>
					<p>
						Get Started by Tracking cost per tag
						<a href="https://docs.litellm.ai/docs/proxy/cost_tracking" target="_blank" rel="noreferrer">here</a>
					</p>
					<UsageChart
						:data="rows"
						index="name"
						:categories="['spend']"
						:colors="['cyan']"
						:height="288"
						:legend-height="42"
						legend
						:format="(value) => String(value)"
				/></UiCard>
			</div>
			<div class="legacy-span2" />
		</div>
	</div>
</template>
