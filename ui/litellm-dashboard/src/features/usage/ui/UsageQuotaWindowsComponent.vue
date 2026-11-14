<script setup lang="ts">
import type { QuotaWindow } from "../api/UpstreamQuotaApi";
import { QUOTA_TONE_COLORS, isRemainingExhausted, remainingTone, roundedRemainingPercent } from "../../platform/logic/QuotaDisplayLogic";
defineProps<{ windows: QuotaWindow[] }>();
function exhaustedClass(value: number | null) {
	return isRemainingExhausted(value) ? "usage-quota-window-name--exhausted" : "";
}
function color(value: number | null) {
	return QUOTA_TONE_COLORS[remainingTone(value)];
}
</script>
<template>
	<div class="usage-quota-windows">
		<div v-for="window in windows" :key="window.id">
			<header>
				<strong :class="exhaustedClass(window.remaining_percent)">{{ window.label }}</strong
				><span>{{ window.remaining_percent === null ? "—" : Math.round(window.remaining_percent) + "% remaining" }}</span>
			</header>
			<div class="usage-quota-progress">
				<i
					:style="{
						width: (roundedRemainingPercent(window.remaining_percent) ?? 0) + '%',
						background: color(window.remaining_percent),
					}"
				/>
			</div>
			<small v-if="window.resets_at">Resets {{ new Date(window.resets_at).toLocaleString() }}</small>
		</div>
	</div>
</template>
