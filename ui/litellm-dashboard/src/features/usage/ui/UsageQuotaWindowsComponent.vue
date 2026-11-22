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
/** 百分比写在条内：条本身被压短了，条内只放数字，完整的「remaining」说法交给 aria 与悬停提示。 */
function valueText(value: number | null) {
	return value === null ? "—" : Math.round(value) + "%";
}
/** 读屏与悬停仍读到完整语义，界面上不占宽度。 */
function valueDescription(value: number | null) {
	return value === null ? "No remaining quota reported" : Math.round(value) + "% remaining";
}
function valueNow(value: number | null) {
	const rounded = roundedRemainingPercent(value);
	return rounded === null ? undefined : rounded;
}
/** 倒计时缩到“in …”：它排在维度名下方，跟名称同宽，不去挤占进度条的横向空间。 */
function resetLabel(value: string | null) {
	return formatShortResetCountdown(value, now.value) ?? "";
}
function resetTitle(value: string | null) {
	return value ? new Date(value).toLocaleString() : undefined;
}
</script>
<template>
	<!-- 各维度横向单行排开、块宽一致；名称在上、倒计时在下，条压在块底部，跨账号才好对齐比较。 -->
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
				:aria-valuetext="valueDescription(window.remaining_percent)"
				:title="valueDescription(window.remaining_percent)"
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
