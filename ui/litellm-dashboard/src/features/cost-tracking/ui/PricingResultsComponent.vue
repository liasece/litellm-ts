<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { createPricingExports } from "../logic/PricingExportLogic";
import type { CostEstimateResponse, MultiModelResult } from "../support/CostTrackingModels";
const props = defineProps<{ result: MultiModelResult; period: "day" | "month" }>();
const money = useMoneyFormatter(),
	exports = createPricingExports(money),
	expanded = ref(new Set<string>()),
	menuOpen = ref(false),
	menuRoot = ref<HTMLElement>();
const valid = computed(() => props.result.entries.filter((row) => row.result !== null)),
	loading = computed(() => props.result.entries.some((row) => row.loading)),
	errors = computed(() => props.result.entries.filter((row) => row.error !== null)),
	models = computed(() => props.result.entries.filter((row) => row.entry.model));
const periodLabel = computed(() => (props.period === "day" ? "Daily" : "Monthly")),
	periodCost = computed(() => (props.period === "day" ? "daily_cost" : "monthly_cost"));
function cost(value: number | null | undefined, model?: string) {
	return money(value, value != null && Math.abs(value) < 1 ? 6 : 2, model);
}
function toggle(id: string) {
	const value = new Set(expanded.value);
	if (value.has(id)) value.delete(id);
	else value.add(id);
	expanded.value = value;
}
function outside(event: MouseEvent) {
	if (event.target instanceof Node && !menuRoot.value?.contains(event.target)) menuOpen.value = false;
}
watch(menuOpen, (value) => {
	if (value) document.addEventListener("mousedown", outside);
	else document.removeEventListener("mousedown", outside);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", outside));
function breakdown(result: CostEstimateResponse, period: boolean) {
	return period
		? [
				{
					label:
						periodLabel.value +
						" Total (" +
						formatNumberWithCommas(
							props.period === "day" ? result.num_requests_per_day : result.num_requests_per_month,
							0,
							true,
						) +
						" req)",
					value: result[periodCost.value],
					className: "cost-breakdown-period-total",
				},
				{
					label: periodLabel.value + " Input",
					value: props.period === "day" ? result.daily_input_cost : result.monthly_input_cost,
				},
				{
					label: periodLabel.value + " Output",
					value: props.period === "day" ? result.daily_output_cost : result.monthly_output_cost,
				},
				{
					label: periodLabel.value + " Margin Fee",
					value: props.period === "day" ? result.daily_margin_cost : result.monthly_margin_cost,
					className: result.margin_cost_per_request > 0 ? "cost-margin-value" : undefined,
				},
			]
		: [
				{ label: "Total/Request", value: result.cost_per_request, className: "cost-breakdown-request-total" },
				{ label: "Input Cost", value: result.input_cost_per_request },
				{ label: "Output Cost", value: result.output_cost_per_request },
				{
					label: "Margin Fee",
					value: result.margin_cost_per_request,
					className: result.margin_cost_per_request > 0 ? "cost-margin-value" : undefined,
				},
			];
}
</script>
<template>
	<div v-if="!valid.length && !loading && !errors.length" class="cost-estimate-empty">Select models above to see cost estimates</div>
	<div v-else-if="!valid.length && loading && !errors.length" class="cost-estimate-loading">
		<UiSpinner />
		<p>Calculating costs...</p>
	</div>
	<div v-else class="cost-results">
		<hr />
		<div class="cost-results-heading">
			<p>Cost Estimates</p>
			<div class="cost-results-actions">
				<UiSpinner v-if="loading" :size="14" />
				<div v-if="valid.length" ref="menuRoot" class="cost-export-menu" @keydown.esc="menuOpen = false">
					<UiButton appearance="tremor" size="small" @click="menuOpen = !menuOpen"
						><template #icon><UiIcon name="DownloadOutlined" /></template>Export</UiButton
					>
					<div v-if="menuOpen" class="cost-export-options">
						<button
							type="button"
							@click="
								exports.exportMultiToPDF(result);
								menuOpen = false;
							"
						>
							<UiIcon name="FilePdfOutlined" style="color: #ef4444" />Export as PDF</button
						><button
							type="button"
							@click="
								exports.exportMultiToCSV(result);
								menuOpen = false;
							"
						>
							<UiIcon name="FileExcelOutlined" style="color: #16a34a" />Export as CSV
						</button>
					</div>
				</div>
			</div>
		</div>
		<template v-if="valid.length">
			<div class="cost-summary-card">
				<div class="cost-summary-grid">
					<div>
						<p>Total Per Request</p>
						<strong style="color: #1890ff">{{ cost(result.totals.cost_per_request) }}</strong>
					</div>
					<div>
						<p>Total {{ periodLabel }}</p>
						<strong :style="{ color: period === 'day' ? '#52c41a' : '#722ed1' }">{{
							cost(period === "day" ? result.totals.daily_cost : result.totals.monthly_cost)
						}}</strong>
					</div>
				</div>
				<div v-if="result.totals.margin_per_request > 0" class="cost-summary-grid cost-summary-margins">
					<div>
						<p>Margin Fee/Request</p>
						<span>{{ cost(result.totals.margin_per_request) }}</span>
					</div>
					<div>
						<p>{{ periodLabel }} Margin Fee</p>
						<span>{{ cost(period === "day" ? result.totals.daily_margin : result.totals.monthly_margin) }}</span>
					</div>
				</div>
			</div>
			<div class="cost-summary-table-wrap">
				<table class="cost-antd-table cost-summary-table">
					<thead>
						<tr>
							<th>Model</th>
							<th>Per Request</th>
							<th>Margin Fee</th>
							<th>{{ periodLabel }}</th>
							<th style="width: 40px" />
						</tr>
					</thead>
					<tbody>
						<template v-for="row in models" :key="row.entry.id"
							><tr>
								<td>
									<div class="cost-summary-model">
										<span>{{ row.result?.model || row.entry.model }}</span
										><UiTag v-if="row.result?.provider" color="blue">{{ row.result.provider }}</UiTag
										><UiSpinner v-if="row.loading" :size="14" />
									</div>
									<div v-if="row.error" class="cost-result-error-inline">⚠️ {{ row.error }}</div>
									<div v-else-if="row.result && row.result.cost_per_request === 0" class="cost-result-zero-warning">
										⚠️ No pricing data found for this model. Set base_model in config.
									</div>
								</td>
								<td :class="{ 'cost-result-missing': row.error }">
									{{ row.error ? "-" : cost(row.result?.cost_per_request, row.result?.model || row.entry.model) }}
								</td>
								<td :class="(row.result?.margin_cost_per_request ?? 0) > 0 ? 'cost-margin-value' : 'cost-result-missing'">
									{{ row.error ? "-" : cost(row.result?.margin_cost_per_request, row.result?.model || row.entry.model) }}
								</td>
								<td :class="{ 'cost-result-missing': row.error }">
									{{ row.error ? "-" : cost(row.result?.[periodCost], row.result?.model || row.entry.model) }}
								</td>
								<td>
									<UiButton
										v-if="!row.error"
										appearance="tremor"
										variant="text"
										size="small"
										:aria-label="'Expand ' + row.entry.model"
										:aria-expanded="expanded.has(row.entry.id)"
										@click="toggle(row.entry.id)"
										><template #icon
											><UiIcon :name="expanded.has(row.entry.id) ? 'DownOutlined' : 'RightOutlined'" /></template
									></UiButton>
								</td>
							</tr>
							<tr v-if="expanded.has(row.entry.id) && row.result">
								<td colspan="5">
									<div class="cost-single-model">
										<div v-if="row.loading" class="cost-single-updating"><UiSpinner :size="14" />Updating...</div>
										<div class="cost-breakdown-grid">
											<div v-for="field in breakdown(row.result, false)" :key="field.label">
												<p>{{ field.label }}</p>
												<span :class="field.className">{{ cost(field.value, row.result.model) }}</span>
											</div>
										</div>
										<div
											v-if="row.result[periodCost] !== null"
											class="cost-breakdown-grid cost-breakdown-period"
											:class="'cost-breakdown-' + period"
										>
											<div v-for="field in breakdown(row.result, true)" :key="field.label">
												<p>{{ field.label }}</p>
												<span :class="field.className">{{ cost(field.value, row.result.model) }}</span>
											</div>
										</div>
										<div
											v-if="row.result.input_cost_per_token || row.result.output_cost_per_token"
											class="cost-token-pricing"
										>
											Token Pricing:
											<span v-if="row.result.input_cost_per_token"
												>Input {{ money(row.result.input_cost_per_token * 1000000, 2, row.result.model) }}/1M</span
											><template v-if="row.result.input_cost_per_token && row.result.output_cost_per_token">
												| </template
											><span v-if="row.result.output_cost_per_token"
												>Output
												{{ money(row.result.output_cost_per_token * 1000000, 2, row.result.model) }}/1M</span
											>
										</div>
									</div>
								</td>
							</tr>
						</template>
					</tbody>
				</table>
			</div>
		</template>
		<template v-else
			><div v-for="row in errors" :key="row.entry.id" class="cost-result-error">
				<strong>{{ row.entry.model || "Unknown model" }}: </strong>{{ row.error }}
			</div></template
		>
	</div>
</template>
