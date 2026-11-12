<script setup lang="ts">
import { computed } from "vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { usageTokenBreakdown, type TokenMetricFields } from "../logic/UsageTokenLogic";
import "../styles/UsageTokensStyles.css";
const props = defineProps<{ metrics: TokenMetricFields }>();
const tokens = computed(() => usageTokenBreakdown(props.metrics)),
	number = (value: number) => formatNumberWithCommas(value, 0, false),
	lines = computed(() => [
		{ key: "cache", label: "Cache", value: tokens.value.cacheRead, color: "#059669" },
		{ key: "input", label: "Input", value: tokens.value.input, color: "#2563eb" },
		{ key: "output", label: "Output", value: tokens.value.output, color: "#0891b2" },
	]),
	summary = computed(
		() =>
			`Cache read ${number(tokens.value.cacheRead)}, input ${number(tokens.value.input)}, output ${number(tokens.value.output)}; ${tokens.value.hitRate}% cache hit`,
	),
	hitTone = computed(() => (tokens.value.hitRate >= 50 ? "is-high" : tokens.value.hitRate > 0 ? "is-mid" : "is-low"));
</script>
<template>
	<UiTooltip>
		<div class="usage-tokens-cell" :aria-label="summary">
			<span v-for="line in lines" :key="line.key" class="usage-tokens-cell-line">
				<i :style="{ backgroundColor: line.color }" aria-hidden="true" />
				<span class="usage-tokens-cell-label">{{ line.label }}</span>
				<b>{{ number(line.value) }}</b>
			</span>
			<span class="usage-tokens-cell-hit" :class="hitTone">{{ tokens.hitRate }}% hit</span>
		</div>
		<template #content>
			<div class="usage-tokens-tooltip">
				<p class="usage-tokens-tooltip-head">Token usage</p>
				<p v-for="line in lines" :key="line.key">
					<span><i :style="{ backgroundColor: line.color }" aria-hidden="true" />{{ line.label }}</span>
					<b>{{ number(line.value) }}</b>
				</p>
				<p v-if="tokens.cacheWrite > 0">
					<span>Cache write</span><b>{{ number(tokens.cacheWrite) }}</b>
				</p>
				<p class="usage-tokens-tooltip-total">
					<span>Total</span><b>{{ number(tokens.total) }}</b>
				</p>
				<p class="usage-tokens-tooltip-rate">{{ tokens.hitRate }}% cache hit rate</p>
			</div>
		</template>
	</UiTooltip>
</template>
