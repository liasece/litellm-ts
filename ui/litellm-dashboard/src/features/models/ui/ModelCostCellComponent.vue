<script setup lang="ts">
import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UpstreamModelHint from "./UpstreamModelHintComponent.vue";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import { modelDisplayName, modelPriceIdentity } from "../logic/ModelDataLogic";
import { UPSTREAM_PRICE_FIELDS } from "../support/UpstreamModelInfoModels";
import type { DisplayProxyModel } from "../support/ModelModels";

/**
 * 单价一格一行：图标区分输入 / 输出 / 缓存读取，与日志的 token 列同一套表达。
 * 三行文字版本在窄列里会被截断或折行，看不出单位与数值；图标 + 数值能压在一行内，
 * 鼠标悬停给出字段名，键盘焦点可读 aria-label。
 */
const props = defineProps<{ model: DisplayProxyModel }>();
const price = usePriceDisplayStore();

interface CostMetric {
	key: string;
	label: string;
	icon: string;
	value: string;
}

const metrics = computed<CostMetric[]>(() => {
	const identity = modelPriceIdentity(props.model);
	const format = (value: number | null | undefined) => (value == null ? "-" : price.format(value, 4, identity));
	const rows: CostMetric[] = [
		{ key: "input", label: "Input", icon: "ArrowDownToLine", value: format(props.model.input_cost) },
		{ key: "output", label: "Output", icon: "ArrowUpFromLine", value: format(props.model.output_cost) },
	];
	if (props.model.cache_read_input_cost != null) {
		rows.push({ key: "cache", label: "Cache read", icon: "Database", value: format(props.model.cache_read_input_cost) });
	}
	return rows;
});
const ariaLabel = computed(() => metrics.value.map((metric) => metric.label + " " + metric.value).join(", "));
/** 任一单价来自上游时挂一个来源图标；气泡里按字段列出全部单价，不每格各挂一个。 */
const priceFromUpstream = computed(() => {
	const filled = props.model.upstream_model_info?.filled_fields ?? [];
	return UPSTREAM_PRICE_FIELDS.some((field) => filled.includes(field));
});
</script>
<template>
	<span class="model-costs" :aria-label="ariaLabel">
		<span v-for="metric in metrics" :key="metric.key" class="model-costs__metric" :title="metric.label + ' cost per 1M tokens'">
			<UiLucideIcon :name="metric.icon" :size="12" class="model-costs__icon" />
			<span class="model-costs__value">{{ metric.value }}</span>
		</span>
		<UpstreamModelHint
			:model="model.model_name"
			:record="model.upstream_model_info"
			:used="priceFromUpstream"
			:fields="UPSTREAM_PRICE_FIELDS"
			:label="modelDisplayName(model)"
		/>
	</span>
</template>
