<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SessionGroupRef } from "../../../support/LogsModels";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import { createSessionTimelineStore } from "../../../stores/SessionTimelineStore";
import { formatSessionKey } from "../../../logic/SessionTimelineContentLogic";
import { keepsTimelineScrollAnchor, reachesTimelineEarlierEnd, timelineAnchorShift } from "../../../logic/SessionTimelineScrollLogic";
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
const root = ref<HTMLElement | null>(null);
let stopScroll: (() => void) | null = null,
	scrollBody: HTMLElement | null = null,
	/** 上一次已经画到页面上的排序，用来区分「来了新事件」和「读者切换了排序」。 */
	renderedNewestFirst = state.newestFirst,
	/** 内容变化前记下的视野内条目（顶部、中部、底部各一个），用来把读者看到的位置固定住。 */
	scrollAnchor: Array<{ id: string; offset: number }> = [];
const TIMELINE_EVENT_SELECTOR = "[data-event-id]";
/**
 * 取出滚动容器视野内的时间线条目。
 *
 * 条目按显示顺序纵向排列、位置单调，二分探测起点即可，长会话不必逐条量取。
 * @param body - 滚动容器
 * @param containerTop - 滚动容器视口顶部在页面坐标中的位置
 * @param containerBottom - 滚动容器视口底部在页面坐标中的位置
 */
function visibleEvents(body: HTMLElement, containerTop: number, containerBottom: number): HTMLElement[] {
	const nodes = body.querySelectorAll<HTMLElement>(TIMELINE_EVENT_SELECTOR);
	let low = 0,
		high = nodes.length - 1,
		start = -1;
	while (low <= high) {
		const middle = (low + high) >> 1,
			node = nodes[middle];
		if (!node) break;
		if (node.getBoundingClientRect().bottom > containerTop) {
			start = middle;
			high = middle - 1;
		} else low = middle + 1;
	}
	if (start < 0) return [];
	const visible: HTMLElement[] = [];
	for (let index = start; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node || node.getBoundingClientRect().top >= containerBottom) break;
		visible.push(node);
	}
	return visible;
}
/**
 * 记录当前阅读位置：视野顶部、中部、底部各一个条目的 id 与相对容器顶部的偏移。
 *
 * 实时更新会把进行中的条目换成新的 id，多个样例保证至少有一个还能对上。
 * 最新优先且停在顶端时不记录：那里正是最新事件的位置，新事件应当直接出现。
 */
function captureScrollAnchor() {
	const body = scrollBody;
	if (!body) return;
	const metrics = {
		newestFirst: state.newestFirst,
		scrollTop: body.scrollTop,
		clientHeight: body.clientHeight,
		scrollHeight: body.scrollHeight,
	};
	scrollAnchor = [];
	// 排序切换是读者主动换看的一端，按新顺序从这一端看起，不补回旧位置。
	if (state.newestFirst !== renderedNewestFirst) return;
	if (!keepsTimelineScrollAnchor(metrics)) return;
	const bounds = body.getBoundingClientRect(),
		containerTop = bounds.top,
		visible = visibleEvents(body, containerTop, bounds.bottom),
		picked = [visible[0], visible[Math.floor(visible.length / 2)], visible[visible.length - 1]];
	scrollAnchor = picked.flatMap((node) => {
		const id = node?.dataset.eventId;
		return node && id ? [{ id: id, offset: node.getBoundingClientRect().top - containerTop }] : [];
	});
}
/**
 * 把锚点条目放回原来的屏幕位置。
 *
 * 实时更新在视野上方插入事件、或往上补了更早的一页时，滚动高度会变大；只补回这段差值，
 * 读者正在看的内容不会跳动，也不会被拉回列表顶端或末尾。
 */
function restoreScrollAnchor() {
	const previous = scrollAnchor,
		body = scrollBody;
	scrollAnchor = [];
	renderedNewestFirst = state.newestFirst;
	if (!previous.length || !body) return;
	const containerTop = body.getBoundingClientRect().top;
	// 视野里的条目可能被实时更新替换掉 id，按顶部、中部、底部的顺序取第一个还在的。
	for (const sample of previous) {
		const node = body.querySelector<HTMLElement>(`${TIMELINE_EVENT_SELECTOR}[data-event-id="${CSS.escape(sample.id)}"]`);
		if (!node) continue;
		const shift = timelineAnchorShift(sample.offset, node.getBoundingClientRect().top - containerTop);
		if (Math.abs(shift) >= 1) body.scrollTop += shift;
		return;
	}
}
/**
 * 滚到「更早」的一端就直接取下一页，取代只靠面板标题旁按钮的手动翻页。
 * @param event - 抽屉内容容器的滚动事件
 */
function loadEarlierWhenScrolled(event: Event) {
	const element = event.currentTarget as HTMLElement;
	if (state.loadingEarlier || !store.canLoadEarlier.value) return;
	const metrics = {
		newestFirst: state.newestFirst,
		scrollTop: element.scrollTop,
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	};
	if (!reachesTimelineEarlierEnd(metrics)) return;
	void store.loadEarlier();
}
onMounted(() => {
	scrollBody = root.value?.closest<HTMLElement>(".ui-drawer__body") ?? null;
	if (!scrollBody) return;
	const body = scrollBody,
		listener = (event: Event) => loadEarlierWhenScrolled(event);
	body.addEventListener("scroll", listener, { passive: true });
	stopScroll = () => body.removeEventListener("scroll", listener);
});
// 列表由抽屉的插槽承载，重新渲染发生在 UiDrawer 里，所以在这里按数据变化取锚点：
// pre 在 DOM 更新前记录位置，post 在更新后补回偏移。
watch(
	() => store.displayed.value,
	() => captureScrollAnchor(),
	{ flush: "pre" },
);
watch(
	() => store.displayed.value,
	() => restoreScrollAnchor(),
	{ flush: "post" },
);
onBeforeUnmount(() => {
	stopScroll?.();
	scrollBody = null;
	scrollAnchor = [];
	store.dispose();
});
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
		<div ref="root" data-testid="session-simulation-drawer" class="session-simulation">
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
					:data-event-id="item.id"
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
