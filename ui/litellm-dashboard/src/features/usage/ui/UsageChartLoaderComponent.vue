<script setup lang="ts">
import "../styles/UsageChartsStyles.css";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
withDefaults(defineProps<{ isDateChanging?: boolean }>(), { isDateChanging: false });
</script>
<template>
	<div class="usage-chart-loader">
		<div>
			<UiSpinner :size="20" />
			<div>
				<span>{{ isDateChanging ? "Processing date selection..." : "Loading chart data..." }}</span
				><small>{{ isDateChanging ? "This will only take a moment" : "Fetching your data" }}</small>
			</div>
		</div>
	</div>
</template>
