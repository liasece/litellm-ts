<script setup lang="ts">
import { provide } from "vue";
import ModelCostCell from "../../src/features/models/ui/ModelCostCellComponent.vue";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import { transformModels } from "../../src/features/models/logic/ModelDataLogic";
import type { ProxyModel } from "../../src/features/models/support/ModelModels";

provide(priceDisplayStoreKey, createPriceDisplayStore());

// 与生产的 /v2/model/info 同形的两行：一行有峰谷定价，一行没有。
const rows: ProxyModel[] = [
	{
		model_name: "opencode-go/deepseek-v4.1-flash",
		litellm_params: {},
		model_info: {
			id: "peak-deployment",
			input_cost_per_token: 1.5e-7,
			output_cost_per_token: 6e-7,
			cache_read_input_token_cost: 3e-9,
			peak_pricing: {
				windows: [
					{ days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
					{ days: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" },
				],
				timezone: "Asia/Shanghai",
				multiplier: 2,
			},
		},
	},
	{
		model_name: "openai/gpt-5.6-mini",
		litellm_params: {},
		model_info: {
			id: "flat-deployment",
			input_cost_per_token: 2.5e-7,
			output_cost_per_token: 1e-6,
			cache_read_input_token_cost: 1.25e-7,
		},
	},
];
const [peakModel, flatModel] = transformModels(rows, {});
</script>
<template>
	<table class="ui-table">
		<tbody>
			<tr data-model="peak">
				<td class="model-cost-cell"><ModelCostCell :model="peakModel" /></td>
			</tr>
			<tr data-model="flat">
				<td class="model-cost-cell"><ModelCostCell :model="flatModel" /></td>
			</tr>
		</tbody>
	</table>
</template>
