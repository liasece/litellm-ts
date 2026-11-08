<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import TremorDateRangePicker from "../../../date-range/ui/TremorDateRangePickerComponent.vue";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import type { DateRangeValue } from "../../../date-range/support/DateRangeModels";
import type { CreatedKeyChoice } from "../../../virtual-keys/stores/CreatedKeysHistoryStore";
import type { LegacyRow } from "../api/LegacyUsageApi";
defineProps<{ rows: LegacyRow[]; keys: CreatedKeyChoice[] }>();
const range = defineModel<DateRangeValue>("range", { required: true }),
	selection = ref("all-keys"),
	money = useMoneyFormatter();
const emit = defineEmits<{ change: [key: string | null] }>();
function choose(value: unknown, keys: CreatedKeyChoice[]) {
	selection.value = String(value);
	emit("change", selection.value === "all-keys" ? null : keys[Number(selection.value)]?.token || null);
}
function dates(value: DateRangeValue) {
	range.value = value;
	emit("change", null);
}
</script>
<template>
	<div class="legacy-customers">
		<p class="legacy-customers-description">
			Customers of your LLM API calls. Tracked when a &#96;user&#96; param is passed in your LLM calls
			<a href="https://docs.litellm.ai/docs/proxy/users" target="_blank" rel="noreferrer">docs here</a>
		</p>
		<div class="legacy-two-columns">
			<TremorDateRangePicker :model-value="range" @update:model-value="dates" />
			<div>
				<p class="legacy-select-label">Select Key</p>
				<UiSelect
					:model-value="selection"
					:options="[
						{ value: 'all-keys', label: 'All Keys' },
						...keys.map((key, index) => ({ value: String(index), label: key.key_alias })),
					]"
					appearance="tremor"
					aria-label="Select Key"
					@update:model-value="choose($event, keys)"
				/>
			</div>
		</div>
		<UiCard appearance="tremor" class="legacy-customer-card"
			><div class="legacy-customer-table legacy-table-scroll">
				<table class="legacy-table">
					<thead>
						<tr>
							<th>Customer</th>
							<th>Spend</th>
							<th>Total Events</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in rows" :key="index">
							<td>{{ row.end_user }}</td>
							<td>{{ money(Number(row.total_spend), 2) }}</td>
							<td>{{ row.total_count }}</td>
						</tr>
					</tbody>
				</table>
			</div></UiCard
		>
	</div>
</template>
