<script setup lang="ts">
/**
 * 费用单价旁的峰谷档位标记。
 *
 * 后端在请求开始时把命中的档位冻结进 `price_snapshot.peak`；这里只做展示，不按
 * 当前时间重新判断。图标与文字同时出现，避免只靠颜色区分峰时/谷时。
 */

import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { priceTierView, type LogPricePeak } from "../support/LogsPriceModels";

const props = withDefaults(defineProps<{ peak?: LogPricePeak | undefined }>(), { peak: undefined });
const view = computed(() => priceTierView(props.peak));
</script>

<template>
	<span v-if="view" class="logs-price-tier" :class="'is-' + view.tier" :data-icon="view.icon" :title="view.description">
		<UiLucideIcon :name="view.icon" :size="12" />
		<span>{{ view.label }}</span>
		<span v-if="view.multiplier" class="logs-price-tier__multiplier">{{ view.multiplier }}</span>
	</span>
</template>

<style scoped>
.logs-price-tier {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	flex: none;
	padding: 1px 6px;
	border: 1px solid transparent;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 500;
	line-height: 16px;
	white-space: nowrap;
}
.logs-price-tier.is-peak {
	border-color: #fde68a;
	background: #fffbeb;
	color: #b45309;
}
.logs-price-tier.is-off_peak {
	border-color: #bfdbfe;
	background: #eff6ff;
	color: #1d4ed8;
}
.logs-price-tier__multiplier {
	font-variant-numeric: tabular-nums;
}
</style>
