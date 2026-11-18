<script setup lang="ts">
/**
 * 上游模型信息提示：只有「这里显示的值真的来自上游」时才出现的小图标，hover 展示上游字段。
 *
 * 图标是来源标记，不是资料入口：模型名、费用、限额旁边默认什么都不显示，只有该值确实
 * 由上游补位时才挂上去。否则每个模型、每个费用格都带一个图标，反而让人分不清哪些值
 * 不是自己配置的。费用位置用 `fields` 只看单价，不把上下文长度混进费用说明。
 */

import { computed, ref } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import { ensureUpstreamModelInfo, peekUpstreamModelInfo, pickUpstreamModelInfo } from "../logic/UpstreamModelInfoLogic";
import {
	formatFreshness,
	shouldShowUpstreamHint,
	upstreamFieldRows,
	type UpstreamModelInfoPayload,
} from "../support/UpstreamModelInfoModels";

const props = withDefaults(
	defineProps<{
		/** 模型组名；用于按名字懒加载。 */
		model: string;
		/** 关注的字段（如 `max_output_tokens`），命中 `filled_fields` 时高亮。 */
		field?: string;
		/** 已知的上游信息块；提供后不再请求。 */
		record?: UpstreamModelInfoPayload | null;
		/** 气泡标题；默认用模型名。 */
		label?: string;
		/**
		 * 当前展示的数值是否确实用了上游信息。
		 * 给了就以此为准（日志费用这类历史行不能按「当前配置」推断）；没给才看 `filled_fields`。
		 */
		used?: boolean;
		/** 气泡里的补充说明（例如费用行的「本次使用上游单价」）。 */
		note?: string;
		/** 只展示这些字段的行；费用位置传单价字段，避免把上下文长度塞进费用气泡。 */
		fields?: readonly string[];
	}>(),
	{ field: undefined, record: undefined, label: undefined, used: undefined, note: undefined, fields: undefined },
);

const loading = ref(false);
const fetched = ref<readonly UpstreamModelInfoPayload[]>(peekUpstreamModelInfo(props.model));

const payloads = computed<readonly UpstreamModelInfoPayload[]>(() =>
	props.record === undefined || props.record === null ? fetched.value : [props.record],
);
const primary = computed(() => pickUpstreamModelInfo(payloads.value));
const rows = computed(() => (primary.value === undefined ? [] : upstreamFieldRows(primary.value, props.fields)));
// 没有真实的上游取值就不渲染图标；`used` 留给调用方显式声明「这个值确实来自上游」。
const related = computed(() => shouldShowUpstreamHint(primary.value, props.field, props.used));
const statusTone = computed(() => {
	const status = primary.value?.status;
	if (status === "ok") {
		return primary.value?.stale === true ? "warn" : "ok";
	}
	return "muted";
});
const title = computed(() => props.label ?? props.model);
const ariaLabel = computed(() => `查看 ${title.value} 的上游模型信息`);

async function load(): Promise<void> {
	if (props.record !== undefined && props.record !== null) {
		return;
	}
	if (fetched.value.length > 0 || loading.value) {
		return;
	}
	loading.value = true;
	try {
		fetched.value = await ensureUpstreamModelInfo(props.model);
	} finally {
		loading.value = false;
	}
}

function onHover(): void {
	void load();
}
</script>

<template>
	<UiPopover v-if="related" trigger="hover" placement="top" popup-class="upstream-hint__popover">
		<button
			type="button"
			class="upstream-hint__anchor"
			:class="`is-${statusTone}`"
			:aria-label="ariaLabel"
			@mouseenter="onHover"
			@focus="onHover"
			@click.prevent
		>
			<UiLucideIcon name="Database" :size="13" />
		</button>
		<template #content>
			<div class="upstream-hint">
				<header class="upstream-hint__header">
					<span class="upstream-hint__title">{{ primary?.display_name || title }}</span>
					<span v-if="primary" class="upstream-hint__source">{{ primary.source }}</span>
				</header>
				<p v-if="note" class="upstream-hint__note">{{ note }}</p>
				<p v-if="loading" class="upstream-hint__muted">正在读取上游信息…</p>
				<template v-else-if="primary">
					<p v-if="primary.status !== 'ok'" class="upstream-hint__error">
						{{
							primary.status === "unsupported"
								? "该上游没有模型信息接口。"
								: `最近一次拉取失败：${primary.error ?? "未知错误"}`
						}}
					</p>
					<p v-else-if="rows.length === 0" class="upstream-hint__muted">上游未返回可用的模型字段。</p>
					<dl v-else class="upstream-hint__rows">
						<div
							v-for="row in rows"
							:key="row.field"
							class="upstream-hint__row"
							:class="{ 'is-focus': row.field === props.field }"
						>
							<dt>{{ row.label }}</dt>
							<dd>
								{{ row.value }}
								<span v-if="primary.filled_fields.includes(row.field)" class="upstream-hint__badge">来自上游</span>
							</dd>
						</div>
					</dl>
					<footer class="upstream-hint__footer">
						<span
							>上游模型 <code>{{ primary.upstream_model }}</code></span
						>
						<span>
							抓取于 {{ formatFreshness(primary.fetched_at) }}
							<span v-if="primary.stale" class="upstream-hint__stale">（已过期，刷新中）</span>
						</span>
					</footer>
				</template>
				<p v-else class="upstream-hint__muted">
					还没有这个模型的上游记录。代理会每 4 小时自动向上游拉取一次；上游没有该模型或接口不支持时会保持为空。
				</p>
			</div>
		</template>
	</UiPopover>
</template>

<style scoped>
.upstream-hint__anchor {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--text-tertiary, #9aa0aa);
	cursor: help;
	vertical-align: middle;
}
.upstream-hint__anchor:hover,
.upstream-hint__anchor:focus-visible {
	color: var(--text-secondary, #5b6270);
	background: var(--surface-subtle, rgba(15, 23, 42, 0.06));
}
/* 图标只在「这个值来自上游」时出现，所以「有信息」就是它的正常底色。 */
.upstream-hint__anchor.is-ok {
	color: var(--color-success, #0f9d58);
}
.upstream-hint__anchor.is-warn {
	color: var(--color-warning, #b45309);
}
.upstream-hint__note {
	margin: 0 0 8px;
	padding: 6px 8px;
	border-radius: 6px;
	background: #ecfdf5;
	color: #065f46;
	font-size: 12px;
	line-height: 1.5;
}
.upstream-hint {
	min-width: 220px;
	max-width: 320px;
	font-size: 12px;
	line-height: 1.5;
}
.upstream-hint__header {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin-bottom: 6px;
}
.upstream-hint__title {
	font-weight: 600;
	color: var(--text-primary, #111827);
}
.upstream-hint__source {
	padding: 0 6px;
	border-radius: 999px;
	background: var(--surface-subtle, rgba(15, 23, 42, 0.06));
	color: var(--text-secondary, #5b6270);
	font-size: 11px;
}
.upstream-hint__rows {
	display: grid;
	gap: 2px;
	margin: 0;
}
.upstream-hint__row {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	padding: 1px 4px;
	border-radius: 4px;
}
.upstream-hint__row.is-focus {
	background: var(--surface-subtle, rgba(15, 23, 42, 0.06));
}
.upstream-hint__row dt {
	color: var(--text-secondary, #5b6270);
}
.upstream-hint__row dd {
	margin: 0;
	color: var(--text-primary, #111827);
	font-variant-numeric: tabular-nums;
}
.upstream-hint__badge {
	margin-left: 6px;
	padding: 0 4px;
	border-radius: 3px;
	background: rgba(15, 157, 88, 0.12);
	color: var(--color-success, #0f9d58);
	font-size: 10px;
}
.upstream-hint__footer {
	display: grid;
	gap: 2px;
	margin-top: 8px;
	padding-top: 6px;
	border-top: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.08));
	color: var(--text-tertiary, #9aa0aa);
	font-size: 11px;
}
.upstream-hint__stale {
	color: var(--color-warning, #b26a00);
}
.upstream-hint__muted {
	margin: 4px 0;
	color: var(--text-tertiary, #9aa0aa);
}
.upstream-hint__error {
	margin: 4px 0;
	color: var(--color-danger, #c62828);
}
</style>
