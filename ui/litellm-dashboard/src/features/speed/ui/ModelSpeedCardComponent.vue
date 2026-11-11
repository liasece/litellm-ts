<script setup lang="ts">
import { computed } from "vue";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { getProviderLogoAndName, modelSupplier } from "../../providers/logic/ProviderIdentityLogic";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { buildSpeedChartRows, formatTps } from "../logic/ModelSpeedLogic";
import type { SpeedBucket, SpeedModelSeries } from "../support/SpeedModels";
import ModelSpeedChartComponent from "./ModelSpeedChartComponent.vue";
const props = defineProps<{ model: SpeedModelSeries; buckets: string[]; bucket: SpeedBucket; timezone: string; yMax: number }>();
const rows = computed(() => buildSpeedChartRows(props.model.points, props.buckets, props.bucket, props.timezone));
// 后端已把历史 cliproxy 行归一成真实订阅供应商；这里再走一遍 modelSupplier，
// 兼容旧响应或缓存里的原始 provider，保证与 Logs 列表同一套身份识别。
const supplier = computed(() => modelSupplier(props.model.model, props.model.provider));
const provider = computed(() => (supplier.value ? getProviderLogoAndName(supplier.value) : null));
const title = computed(() => (provider.value ? props.model.model + " · " + provider.value.displayName : props.model.model));
</script>
<template>
	<div class="speed-card" data-testid="model-speed-card">
		<div class="speed-card-header">
			<div class="speed-card-name">
				<div class="speed-card-title" :title="title">
					<ModelName class="speed-card-model" :model="model.model" :provider="model.provider" :size="22" :truncate="true" />
				</div>
				<p class="speed-card-meta">
					<span v-if="provider" class="speed-card-provider" :title="provider.displayName + ' · ' + model.provider">
						<ProviderLogoComponent
							:provider="provider.displayName"
							:logo="provider.logo"
							alt=""
							image-class="speed-card-provider-logo"
							fallback-class="speed-card-provider-logo"
						/>
						<span class="speed-card-provider-name">{{ provider.displayName }}</span>
					</span>
					<span v-if="provider" class="speed-card-meta-separator" aria-hidden="true">·</span>
					<span class="speed-card-requests">{{ formatNumberWithCommas(model.requests) }} 个可用请求</span>
				</p>
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
