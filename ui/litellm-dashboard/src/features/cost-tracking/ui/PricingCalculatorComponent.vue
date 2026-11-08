<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { createPricingCalculatorStore } from "../stores/PricingCalculatorStore";
import PricingResultsComponent from "./PricingResultsComponent.vue";
defineProps<{ models: string[] }>();
const store = createPricingCalculatorStore();
function commas(value: number | string | null | undefined) {
	return String(value ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function volume(value: number | string | null | undefined) {
	return value ? commas(value) : "";
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="cost-pricing-calculator">
		<div class="cost-time-period" role="radiogroup" aria-label="Request volume period">
			<button
				type="button"
				role="radio"
				:aria-checked="store.state.period === 'day'"
				:class="{ selected: store.state.period === 'day' }"
				@click="store.setPeriod('day')"
			>
				Per Day</button
			><button
				type="button"
				role="radio"
				:aria-checked="store.state.period === 'month'"
				:class="{ selected: store.state.period === 'month' }"
				@click="store.setPeriod('month')"
			>
				Per Month
			</button>
		</div>
		<div class="cost-pricing-table-wrap">
			<table class="cost-antd-table cost-pricing-table">
				<colgroup>
					<col style="width: 35%" />
					<col style="width: 18%" />
					<col style="width: 18%" />
					<col style="width: 20%" />
					<col style="width: 50px" />
				</colgroup>
				<thead>
					<tr>
						<th>Model</th>
						<th>Input Tokens</th>
						<th>Output Tokens</th>
						<th>Requests/{{ store.state.period === "day" ? "Day" : "Month" }}</th>
						<th />
					</tr>
				</thead>
				<tbody>
					<tr v-for="entry in store.state.entries" :key="entry.id">
						<td>
							<UiSelect
								:model-value="entry.model || null"
								:options="models.map((model) => ({ value: model, label: model }))"
								searchable
								placeholder="Select a model"
								size="small"
								@update:model-value="store.change(entry.id, 'model', String($event ?? ''))"
							/>
						</td>
						<td>
							<UiInputNumber
								:model-value="entry.input_tokens"
								:min="0"
								size="small"
								:formatter="commas"
								aria-label="Input Tokens"
								@update:model-value="store.change(entry.id, 'input_tokens', $event ?? 0)"
							/>
						</td>
						<td>
							<UiInputNumber
								:model-value="entry.output_tokens"
								:min="0"
								size="small"
								:formatter="commas"
								aria-label="Output Tokens"
								@update:model-value="store.change(entry.id, 'output_tokens', $event ?? 0)"
							/>
						</td>
						<td>
							<UiInputNumber
								:model-value="
									(store.state.period === 'day' ? entry.num_requests_per_day : entry.num_requests_per_month) ?? null
								"
								:min="0"
								size="small"
								:formatter="volume"
								placeholder="-"
								:aria-label="'Requests/' + (store.state.period === 'day' ? 'Day' : 'Month')"
								@update:model-value="
									store.change(
										entry.id,
										store.state.period === 'day' ? 'num_requests_per_day' : 'num_requests_per_month',
										$event ?? undefined,
									)
								"
							/>
						</td>
						<td>
							<UiButton
								variant="text"
								size="small"
								danger
								:disabled="store.state.entries.length === 1"
								aria-label="Remove model"
								@click="store.remove(entry.id)"
								><template #icon><UiIcon name="DeleteOutlined" /></template
							></UiButton>
						</td>
					</tr>
				</tbody>
			</table>
			<div class="cost-pricing-table-footer">
				<UiButton class="cost-add-model" @click="store.add"
					><template #icon><UiIcon name="PlusOutlined" /></template>Add Another Model</UiButton
				>
			</div>
		</div>
		<PricingResultsComponent :result="store.result.value" :period="store.state.period" />
	</div>
</template>
