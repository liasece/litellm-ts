<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import SpeedEmptyStateComponent from "./SpeedEmptyStateComponent.vue";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { getProviderLogoAndName, modelSupplier } from "../../providers/logic/ProviderIdentityLogic";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import {
	filterSpeedModels,
	resolveSpeedAxisMax,
	SPEED_FULL_SATURATION_TPS,
	SPEED_RANGE_OPTIONS,
	speedModelKey,
	speedStrokeColor,
} from "../logic/ModelSpeedLogic";
import { createModelSpeedStore } from "../stores/ModelSpeedStore";
import ModelSpeedCardComponent from "./ModelSpeedCardComponent.vue";
import "./SpeedStyles.css";
const store = createModelSpeedStore(),
	state = store.state;
const models = computed(() => filterSpeedModels(state.data?.models ?? [], state.query)),
	axisMax = computed(() => resolveSpeedAxisMax(models.value)),
	without = computed(() =>
		(state.data?.models_without_speed ?? []).map((entry) => {
			const supplier = modelSupplier(entry.model, entry.provider);
			return { ...entry, supplier: supplier, supplierLabel: supplier ? getProviderLogoAndName(supplier).displayName : "" };
		}),
	),
	count = computed(() => state.data?.models.length ?? 0);
function withoutTitle(entry: { model: string; supplierLabel: string; calls: number }): string {
	const identity = entry.supplierLabel ? entry.model + " · " + entry.supplierLabel : entry.model;
	return identity + " · " + entry.calls + " 次调用";
}
const gradient =
	"linear-gradient(90deg, " +
	speedStrokeColor(0) +
	", " +
	speedStrokeColor(SPEED_FULL_SATURATION_TPS / 2) +
	", " +
	speedStrokeColor(SPEED_FULL_SATURATION_TPS) +
	")";
onMounted(store.initialize);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="speed-page">
		<div class="speed-header">
			<div>
				<h1>Speed</h1>
				<p>
					输出 TPS = 输出 token 数 ÷ 请求总耗时，与 Logs 页「输出 TPS」列同一口径。
					按<strong>实际执行请求的上游模型与供应商</strong>归组： 发生 fallback 时算在真正执行的模型上，而不是客户端请求的模型名；
					同一个上游模型由不同供应商执行时分开显示，卡片上标注实际供应商并配图标。 只统计输出不少于
					{{ state.data?.min_output_tokens ?? 20 }} 个 token、且耗时大于 0 的调用；每个时间段至少要有
					{{ state.data?.min_bucket_requests ?? 3 }} 个请求才作为数据点，样本不足的时段留空、曲线在那里断开。 纵轴固定从 0
					起，曲线越红表示越快。
				</p>
			</div>
			<UiSelect
				:model-value="state.rangeDays"
				:options="SPEED_RANGE_OPTIONS"
				aria-label="统计区间"
				@update:model-value="store.setRange(Number($event))"
			/>
		</div>
		<UiAlert v-if="state.error" type="error" title="加载模型速度失败">{{ state.error.message || "请稍后重试" }}</UiAlert>
		<div v-if="state.loading && !state.data" class="speed-loading">
			<UiSpinner />
			<p>正在加载模型速度…</p>
		</div>
		<template v-if="state.data"
			><div class="speed-summary">
				<span
					>{{ state.range.startDate }} 至 {{ state.range.endDate }}（{{ state.timezone }}，{{
						state.data.bucket === "hour" ? "按小时聚合" : "按天聚合"
					}}）</span
				><span class="speed-separator">|</span><span>{{ formatNumberWithCommas(count) }} 个模型/供应商组合有可测算的输出速度</span
				><template v-if="without.length"
					><span class="speed-separator">|</span
					><span>另有 {{ formatNumberWithCommas(without.length) }} 个模型/供应商组合有调用但没有可测算输出</span></template
				><template v-if="count"
					><span class="speed-separator">|</span
					><span class="speed-legend"
						><span>越红越快</span><span aria-hidden="true" :style="{ background: gradient }" /><span
							>0 / {{ SPEED_FULL_SATURATION_TPS }} TPS</span
						></span
					></template
				>
			</div>
			<UiInput
				v-if="count"
				v-model="state.query"
				clearable
				aria-label="搜索模型或供应商"
				class="speed-search"
				placeholder="搜索模型或供应商"
			/>
			<div v-if="models.length" class="speed-grid">
				<ModelSpeedCardComponent
					v-for="model in models"
					:key="speedModelKey(model)"
					:model="model"
					:buckets="state.data.buckets"
					:bucket="state.data.bucket"
					:timezone="state.data.timezone"
					:y-max="axisMax"
				/>
			</div>
			<SpeedEmptyStateComponent
				v-else
				:description="count ? '没有匹配「' + state.query.trim() + '」的模型或供应商' : '所选区间内没有可测算的输出速度数据'"
			/>
			<div v-if="without.length" class="speed-without">
				<div>有调用但没有可测算输出速度的模型/供应商组合</div>
				<p>
					这些模型/供应商组合在区间内只有不可测算的调用（例如图片生成、检索工具、失败请求，或输出不足
					{{ state.data.min_output_tokens ?? 20 }} 个 token），或者每个时段的样本都少于
					{{ state.data.min_bucket_requests ?? 3 }} 个请求；因此没有 TPS 曲线。列出它们是为了说明「为什么这里有模型却没有图」。
				</p>
				<div class="speed-without-models">
					<ModelName
						v-for="entry in without"
						:key="speedModelKey(entry)"
						class="speed-without-model"
						:model="entry.model"
						:provider="entry.supplier"
						:size="14"
						:title="withoutTitle(entry)"
					>
						<span class="speed-without-name">{{ entry.model }}</span>
						<span v-if="entry.supplierLabel" class="speed-without-provider">· {{ entry.supplierLabel }}</span>
						<span class="speed-without-calls">({{ formatNumberWithCommas(entry.calls) }})</span>
					</ModelName>
				</div>
			</div>
		</template>
	</div>
</template>
