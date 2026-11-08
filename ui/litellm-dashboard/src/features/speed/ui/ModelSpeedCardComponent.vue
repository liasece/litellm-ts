<script setup lang="ts">
import { computed } from "vue";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { buildSpeedChartRows, formatTps } from "../logic/ModelSpeedLogic";
import type { SpeedBucket, SpeedModelSeries } from "../support/SpeedModels";
import ModelSpeedChartComponent from "./ModelSpeedChartComponent.vue";
const props = defineProps<{ model: SpeedModelSeries; buckets: string[]; bucket: SpeedBucket; timezone: string; yMax: number }>();
const rows = computed(() => buildSpeedChartRows(props.model.points, props.buckets, props.bucket, props.timezone));
</script>
<template>
	<div class="speed-card" data-testid="model-speed-card">
		<div class="speed-card-header">
			<div class="speed-card-name">
				<div :title="model.model">{{ model.model }}</div>
				<p>{{ formatNumberWithCommas(model.requests) }} 个可用请求</p>
			</div>
			<div class="speed-card-metric">
				<div>{{ formatTps(model.avg_tps) }}</div>
				<div>TPS</div>
			</div>
		</div>
		<ModelSpeedChartComponent :rows="rows" :bucket="bucket" :timezone="timezone" :y-max="yMax" />
		<div class="speed-card-footer">中位 {{ formatTps(model.p50_tps) }} TPS · 全部调用 {{ formatNumberWithCommas(model.calls) }}</div>
	</div>
</template>
