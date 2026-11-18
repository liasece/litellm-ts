<script setup lang="ts">
/**
 * 上游模型信息的事实块：给定模型组名，读取并展示上游抓到的限额/价格/能力。
 *
 * 与 `UpstreamModelHint` 共用同一份缓存，区别是这里直接铺开一行行字段——适合放进
 * 已有的日志/用量浮层里，避免再套一层 hover。
 */

import { computed, onMounted, ref } from "vue";
import { ensureUpstreamModelInfo, peekUpstreamModelInfo, pickUpstreamModelInfo } from "../logic/UpstreamModelInfoLogic";
import { upstreamFieldRows, type UpstreamModelInfoPayload } from "../support/UpstreamModelInfoModels";

const props = withDefaults(
	defineProps<{
		model: string;
		record?: UpstreamModelInfoPayload | null;
		/** 紧凑模式只显示一行：上下文 / 输出 / 价格。 */
		compact?: boolean;
	}>(),
	{ record: undefined, compact: false },
);

const loading = ref(false);
const payloads = ref<readonly UpstreamModelInfoPayload[]>(peekUpstreamModelInfo(props.model));
const payload = computed(() =>
	props.record === undefined || props.record === null ? pickUpstreamModelInfo(payloads.value) : props.record,
);
const rows = computed(() => (payload.value === undefined ? [] : upstreamFieldRows(payload.value)));

onMounted(async () => {
	if (props.record !== undefined && props.record !== null) {
		return;
	}
	if (payloads.value.length > 0) {
		return;
	}
	loading.value = true;
	try {
		payloads.value = await ensureUpstreamModelInfo(props.model);
	} finally {
		loading.value = false;
	}
});
</script>

<template>
	<div class="upstream-facts" :class="{ 'upstream-facts--compact': compact }">
		<span v-if="loading" class="upstream-facts__muted">正在读取上游信息…</span>
		<template v-else-if="payload">
			<span v-if="payload.status !== 'ok'" class="upstream-facts__muted">
				{{ payload.status === "unsupported" ? "该上游没有模型信息接口。" : `上游拉取失败：${payload.error ?? "未知错误"}` }}
			</span>
			<template v-else>
				<span v-if="rows.length === 0" class="upstream-facts__muted">上游未返回可用的模型字段。</span>
				<template v-else>
					<span v-for="row in rows" :key="row.field" class="upstream-facts__item">
						<span class="upstream-facts__label">{{ row.label }}</span>
						<span class="upstream-facts__value">{{ row.value }}</span>
					</span>
				</template>
			</template>
			<span class="upstream-facts__source">来源 {{ payload.source }}</span>
		</template>
		<span v-else class="upstream-facts__muted">上游暂无该模型信息（每 4 小时自动重试）。</span>
	</div>
</template>

<style scoped>
.upstream-facts {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 12px;
	font-size: 12px;
	color: var(--text-secondary, #5b6270);
}
.upstream-facts--compact {
	font-size: 12px;
	gap: 4px 10px;
}
.upstream-facts__item {
	display: inline-flex;
	align-items: baseline;
	gap: 4px;
}
.upstream-facts__label {
	color: var(--text-tertiary, #9aa0aa);
}
.upstream-facts__value {
	color: var(--text-primary, #111827);
	font-variant-numeric: tabular-nums;
}
.upstream-facts__source {
	padding: 0 6px;
	border-radius: 999px;
	background: var(--surface-subtle, rgba(15, 23, 42, 0.06));
	font-size: 11px;
}
.upstream-facts__muted {
	color: var(--text-tertiary, #9aa0aa);
}
</style>
