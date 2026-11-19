<script setup lang="ts">
import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UpstreamModelHint from "./UpstreamModelHintComponent.vue";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import { modelDisplayName, modelPriceIdentity } from "../logic/ModelDataLogic";
import { modelCostTiers, peakPricingSummary, type ModelCostTier } from "../logic/ModelPriceTierLogic";
import { UPSTREAM_PRICE_FIELDS } from "../support/UpstreamModelInfoModels";
import type { DisplayProxyModel } from "../support/ModelModels";

/**
 * 单价一格一行：图标区分输入 / 输出 / 缓存读取，与日志的 token 列同一套表达。
 * 三行文字版本在窄列里会被截断或折行，看不出单位与数值；图标 + 数值能压在一行内，
 * 鼠标悬停给出字段名，键盘焦点可读 aria-label。
 *
 * 有峰谷定价时每格内部再分两排（空闲价 / 峰时价）：峰时是基础价乘倍率，只给一排会让
 * 人以为当前配置永远是那个价。档位之间的差异用左侧档位标签表达，单个数值仍是图标 + 数字。
 */
const props = defineProps<{ model: DisplayProxyModel }>();
const price = usePriceDisplayStore();

interface CostMetric {
	key: string;
	label: string;
	icon: string;
	value: string;
}

/** 一格里的一个档位：空闲价固定，峰时价按倍率放大。 */
interface CostTierRow {
	key: ModelCostTier["key"];
	label?: string;
	icon?: string;
	metrics: CostMetric[];
}

const tiers = computed<CostTierRow[]>(() => {
	const identity = modelPriceIdentity(props.model);
	const format = (value: number | null | undefined) => (value == null ? "-" : price.format(value, 4, identity));
	const metricsAt = (factor: number): CostMetric[] => {
		const rows: CostMetric[] = [
			{ key: "input", label: "Input", icon: "ArrowDownToLine", value: format(scale(props.model.input_cost, factor)) },
			{ key: "output", label: "Output", icon: "ArrowUpFromLine", value: format(scale(props.model.output_cost, factor)) },
		];
		if (props.model.cache_read_input_cost != null) {
			rows.push({
				key: "cache",
				label: "Cache read",
				icon: "Database",
				value: format(scale(props.model.cache_read_input_cost, factor)),
			});
		}
		return rows;
	};
	return modelCostTiers(props.model.peak_pricing ?? undefined).map((tier) => ({
		key: tier.key,
		...(tier.label === undefined ? {} : { label: tier.label }),
		...(tier.icon === undefined ? {} : { icon: tier.icon }),
		metrics: metricsAt(tier.multiplier),
	}));
});

/** 峰时行在悬停时说明窗口，操作者不用回配置里找时段。 */
const tierHint = computed(() => {
	const peak = props.model.peak_pricing;
	if (peak === undefined || peak === null) return "";
	return peakPricingSummary(peak);
});
const tiered = computed(() => tiers.value.length > 1);
const ariaLabel = computed(() =>
	tiers.value
		.map((tier) => {
			const prefix = tier.label === undefined ? "" : tier.label + ": ";
			return prefix + tier.metrics.map((metric) => metric.label + " " + metric.value).join(", ");
		})
		.join("; "),
);
/** 任一单价来自上游时挂一个来源图标；气泡里按字段列出全部单价，不每格各挂一个。 */
const priceFromUpstream = computed(() => {
	const filled = props.model.upstream_model_info?.filled_fields ?? [];
	return UPSTREAM_PRICE_FIELDS.some((field) => filled.includes(field));
});

/**
 * 单价按档位倍数放大；缺省值保持缺省，避免把“未配置”算成 0 展示。
 * @param value - 每百万 token 基础单价
 * @param factor - 档位倍数
 */
function scale(value: number | null | undefined, factor: number): number | null {
	return value == null ? null : value * factor;
}
</script>
<template>
	<span class="model-costs" :class="{ 'model-costs--tiered': tiered }" :aria-label="ariaLabel">
		<span v-for="(tier, index) in tiers" :key="tier.key" class="model-costs__row" :data-tier="tier.key">
			<span v-if="tier.label" class="model-costs__tier" :title="index > 0 ? tierHint : undefined">
				<UiLucideIcon :name="tier.icon ?? 'Circle'" :size="11" class="model-costs__tier-icon" />{{ tier.label }}
			</span>
			<span
				v-for="metric in tier.metrics"
				:key="metric.key"
				class="model-costs__metric"
				:title="metric.label + ' cost per 1M tokens'"
			>
				<UiLucideIcon :name="metric.icon" :size="12" class="model-costs__icon" />
				<span class="model-costs__value">{{ metric.value }}</span>
			</span>
			<UpstreamModelHint
				v-if="index === 0"
				:model="model.model_name"
				:record="model.upstream_model_info"
				:used="priceFromUpstream"
				:fields="UPSTREAM_PRICE_FIELDS"
				:label="modelDisplayName(model)"
			/>
		</span>
	</span>
</template>
