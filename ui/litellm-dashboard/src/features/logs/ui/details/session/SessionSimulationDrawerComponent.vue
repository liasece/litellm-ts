<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import type { SessionGroupRef } from "../../../support/LogsModels";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import { createSessionTimelineStore } from "../../../stores/SessionTimelineStore";
import { formatSessionKey } from "../../../logic/SessionTimelineContentLogic";
import { useMoneyFormatter } from "../../../../platform/stores/PriceDisplayStore";
import UiDrawer from "../../../../platform/ui/UiDrawer.vue";
import UiButton from "../../../../platform/ui/UiButton.vue";
import UiIcon from "../../../../platform/ui/UiIcon.vue";
import UiTag from "../../../../platform/ui/UiTag.vue";
import UiAlert from "../../../../platform/ui/UiAlert.vue";
import UiSpinner from "../../../../platform/ui/UiSpinner.vue";
import UiEmptyState from "../../../../platform/ui/UiEmptyState.vue";
import UiLucideIcon from "../../../../platform/ui/UiLucideIcon.vue";
import SessionTimelineEventContentComponent from "./SessionTimelineEventContentComponent.vue";
import "./SessionTimelineStyles.css";
import "./SessionContextStyles.css";
const props = defineProps<{ open: boolean; sessionGroup: SessionGroupRef; teamId?: string }>();
defineEmits<{ close: []; "open-log": [event: SessionTimelineEvent] }>();
const store = createSessionTimelineStore(),
	state = store.state,
	money = useMoneyFormatter(),
	summary = computed(() => state.response?.summary),
	keys = computed(() => (summary.value?.keys ?? []).map(formatSessionKey));
watch(
	[() => props.open, () => props.sessionGroup.type, () => props.sessionGroup.id, () => props.teamId],
	() => store.bind(props.sessionGroup, props.teamId, props.open),
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
const tones = {
	assistant: { dot: "#409eff", tag: "blue", icon: "Bot" },
	user: { dot: "#67c23a", tag: "green", icon: "UserRound" },
	tool: { dot: "#e6a23c", tag: "gold", icon: "Wrench" },
	error: { dot: "#f56c6c", tag: "red", icon: "CircleAlert" },
	system: { dot: "#909399", tag: "default", icon: "Cog" },
	request: { dot: "#909399", tag: "default", icon: "Cog" },
};
function date(value: string) {
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? new Intl.DateTimeFormat("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false,
			}).format(date)
		: value;
}
</script>
<template>
	<UiDrawer
		:open="open"
		width="min(1100px, calc(100vw - 32px))"
		class="session-simulation-drawer"
		title="Session 模拟"
		@close="$emit('close')"
		><template #title
			><span class="session-simulation-title">Session 模拟</span
			><span class="session-simulation-id">{{ sessionGroup.id }}</span></template
		>
		<div data-testid="session-simulation-drawer" class="session-simulation">
			<div class="session-simulation__summary">
				<div class="session-simulation__summary-row">
					<div class="session-simulation__stats">
						<span :title="keys.join('、') || '未记录 Key'"
							><UiLucideIcon name="KeyRound" :size="13" /><span>{{ keys.length > 1 ? "Keys" : "Key" }}</span
							><strong data-testid="session-simulation-keys" class="session-simulation__keys">{{
								keys.join("、") || "-"
							}}</strong></span
						><span
							><strong>{{ summary?.request_count ?? 0 }}</strong> 请求</span
						><span
							><strong>{{ summary?.event_count ?? store.combined.value.length }}</strong> 时间线事件</span
						><span
							><strong>{{ (summary?.total_tokens ?? 0).toLocaleString() }}</strong> tokens</span
						><strong>{{ money(summary?.total_spend ?? 0) }}</strong
						><strong>{{ (summary?.duration_seconds ?? 0).toFixed(2) }}s</strong>
					</div>
					<div class="ld-inline">
						<UiTag v-if="state.streaming" color="processing" data-testid="session-simulation-streaming">实时更新</UiTag
						><UiTag
							v-if="(summary?.in_progress_request_count ?? state.response?.active_requests?.length ?? 0) > 0"
							color="blue"
							data-testid="session-simulation-in-progress"
							>{{ summary?.in_progress_request_count ?? state.response?.active_requests?.length }} 个请求进行中</UiTag
						><UiButton size="small" @click="state.newestFirst = !state.newestFirst"
							><template #icon
								><UiIcon :name="state.newestFirst ? 'SortDescendingOutlined' : 'SortAscendingOutlined'" /></template
							>{{ state.newestFirst ? "最新优先" : "最早优先" }}</UiButton
						>
					</div>
				</div>
				<div class="session-simulation__explanation">
					{{
						state.streaming
							? "按历史 Spend Logs 重放并实时更新，进行中的请求会随推送补全；仅用于查看，不会重新调用模型。"
							: "按历史 Spend Logs 重放，仅用于查看，不会重新调用模型。"
					}}
				</div>
			</div>
			<div
				v-if="state.response?.window && (store.canLoadEarlier.value || state.earlier.length)"
				class="session-simulation__window"
				data-testid="session-simulation-window"
			>
				<span
					>长会话按窗口加载：已显示最近 {{ state.response.window.returned_requests }} 个请求（会话共
					{{ state.response.window.total_requests }} 个）{{
						state.earlier.length ? "，另外加载了更早的 " + state.earlier.length + " 个事件" : ""
					}}</span
				><span class="ld-inline"
					><span v-if="state.earlierError" class="ld-danger">{{ state.earlierError }}</span
					><UiButton
						v-if="store.canLoadEarlier.value"
						size="small"
						:loading="state.loadingEarlier"
						data-testid="session-simulation-load-earlier"
						@click="store.loadEarlier"
						>加载更早</UiButton
					></span
				>
			</div>
			<div v-if="state.loading && !state.response" class="session-simulation__empty"><UiSpinner />正在加载 Session 历史…</div>
			<div v-else-if="state.error && !state.response" class="session-simulation__error">
				<UiAlert type="error" title="Session 模拟加载失败"
					>{{ state.error
					}}<template #action
						><UiButton size="small" :loading="state.refreshing" @click="store.refresh">重试</UiButton></template
					></UiAlert
				>
			</div>
			<div v-else-if="!store.displayed.value.length" class="session-simulation__empty">
				<UiEmptyState description="暂无历史会话" />
			</div>
			<div v-else class="session-timeline">
				<div class="session-timeline__line" />
				<div
					v-for="(item, index) in store.displayed.value"
					:key="item.id"
					class="session-timeline__event"
					:class="{ 'session-timeline__event--last': index === store.displayed.value.length - 1 }"
				>
					<div
						class="session-timeline__dot"
						:style="{
							borderColor: item.role === 'user' ? tones[item.role].dot : 'transparent',
							background: item.role === 'user' ? '#fff' : tones[item.role].dot,
						}"
					>
						<span v-if="item.role !== 'user'" />
					</div>
					<div class="session-timeline__event-body">
						<div class="session-timeline__event-header">
							<span>{{ date(item.timestamp) }}</span
							><UiTag :color="tones[item.role].tag"
								><UiLucideIcon :name="tones[item.role].icon" :size="13" />{{ item.label }}</UiTag
							><UiTag v-if="item.internal_call" color="purple">内置能力 · {{ item.builtin_capability ?? "unknown" }}</UiTag
							><UiTag v-if="item.status === 'in_progress'" color="processing">进行中</UiTag
							><span class="session-timeline__model">{{ item.model }}</span
							><button
								type="button"
								class="session-timeline__log-link"
								:title="'查看 Log ' + item.request_id"
								:aria-label="'查看 Log ' + item.request_id"
								@click="$emit('open-log', item)"
							>
								{{ item.request_id }}
							</button>
						</div>
						<div
							:class="item.role === 'tool' ? '' : 'session-timeline__content'"
							:style="{ borderColor: item.role === 'error' ? '#fecaca' : undefined }"
						>
							<SessionTimelineEventContentComponent :item="item" />
						</div>
					</div>
				</div>
			</div></div
	></UiDrawer>
</template>
