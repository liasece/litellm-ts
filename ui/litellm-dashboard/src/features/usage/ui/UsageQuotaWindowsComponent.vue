<script setup lang="ts">
import type { QuotaWindow } from "../api/UpstreamQuotaApi";
defineProps<{ windows: QuotaWindow[] }>();
function exhaustedClass(value: number | null) {
	return value !== null && value <= 0 ? "usage-quota-window-name--exhausted" : "";
}
function color(value: number | null) {
	return value !== null && value < 20 ? "#ff4d4f" : value !== null && value < 50 ? "#faad14" : "#52c41a";
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
						width: Math.max(0, Math.min(100, Math.round(window.remaining_percent ?? 0))) + '%',
						background: color(window.remaining_percent),
					}"
				/>
			</div>
			<small v-if="window.resets_at">Resets {{ new Date(window.resets_at).toLocaleString() }}</small>
		</div>
	</div>
</template>
