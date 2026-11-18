<script setup lang="ts">
import type { QuotaWindow } from "../api/UpstreamQuotaApi";
import {
	formatResetCountdown,
	QUOTA_TONE_COLORS,
	isRemainingExhausted,
	remainingTone,
	roundedRemainingPercent,
} from "../../platform/logic/QuotaDisplayLogic";
import { useRelativeTimeClock } from "../../platform/stores/RelativeTimeClock";
defineProps<{ windows: QuotaWindow[] }>();
const now = useRelativeTimeClock();
function exhaustedClass(value: number | null) {
	return isRemainingExhausted(value) ? "usage-quota-window-name--exhausted" : "";
}
function color(value: number | null) {
	return QUOTA_TONE_COLORS[remainingTone(value)];
}
function resetLabel(value: string | null) {
	const countdown = formatResetCountdown(value, now.value);
	return countdown === null ? null : `Resets ${countdown}`;
}
function resetTitle(value: string | null) {
	return value ? new Date(value).toLocaleString() : undefined;
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
			<small v-if="resetLabel(window.resets_at)" :title="resetTitle(window.resets_at)">{{ resetLabel(window.resets_at) }}</small>
		</div>
	</div>
</template>
