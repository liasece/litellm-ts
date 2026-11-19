<script setup lang="ts">
import type { QuotaWindow } from "../api/UpstreamQuotaApi";
import {
	formatShortResetCountdown,
	QUOTA_TONE_COLORS,
	isRemainingExhausted,
	remainingTone,
	roundedRemainingPercent,
} from "../../platform/logic/QuotaDisplayLogic";
import { useRelativeTimeClock } from "../../platform/stores/RelativeTimeClock";
defineProps<{ windows: QuotaWindow[] }>();
const now = useRelativeTimeClock();
function exhaustedClass(value: number | null) {
	return isRemainingExhausted(value) ? "usage-quota-window-label--exhausted" : "";
}
function color(value: number | null) {
	return QUOTA_TONE_COLORS[remainingTone(value)];
}
/** 百分比写在条内，配套的 aria 数值与文本保持同一份口径。 */
function valueText(value: number | null) {
	return value === null ? "—" : Math.round(value) + "% remaining";
}
function valueNow(value: number | null) {
	const rounded = roundedRemainingPercent(value);
	return rounded === null ? undefined : rounded;
}
/** 放在进度条右侧的倒计时只保留“in …”：位置本身已说明这是重置时间，前缀会把这一列撑宽。 */
function resetLabel(value: string | null) {
	return formatShortResetCountdown(value, now.value) ?? "";
}
function resetTitle(value: string | null) {
	return value ? new Date(value).toLocaleString() : undefined;
}
</script>
<template>
	<!-- 一个窗口一行：名称、重置倒计时、进度条（百分比写在条内），行高不随文字折行增长。 -->
	<div class="usage-quota-windows">
		<div v-for="window in windows" :key="window.id" class="usage-quota-window">
			<strong class="usage-quota-window-label" :class="exhaustedClass(window.remaining_percent)" :title="window.label">{{
				window.label
			}}</strong>
			<small class="usage-quota-window-reset" :title="resetTitle(window.resets_at)"
				><span class="ui-sr-only">Resets </span>{{ resetLabel(window.resets_at) }}</small
			>
			<div
				class="usage-quota-window-track"
				role="progressbar"
				aria-valuemin="0"
				aria-valuemax="100"
				:aria-valuenow="valueNow(window.remaining_percent)"
				:aria-valuetext="valueText(window.remaining_percent)"
			>
				<i
					class="usage-quota-window-fill"
					:style="{
						width: (roundedRemainingPercent(window.remaining_percent) ?? 0) + '%',
						background: color(window.remaining_percent),
					}"
				/>
				<span class="usage-quota-window-value">{{ valueText(window.remaining_percent) }}</span>
			</div>
		</div>
	</div>
</template>
