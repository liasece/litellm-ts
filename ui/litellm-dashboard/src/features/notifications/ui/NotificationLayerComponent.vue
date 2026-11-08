<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, type VNode } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { notificationStore } from "../stores/NotificationStore";
import { receiveNotificationEvent } from "../logic/NotificationManager";
import {
	notificationPlacements,
	type NotificationContent,
	type NotificationEntry,
	type NotificationKind,
} from "../support/NotificationModels";
import "./NotificationStyles.css";
const target = ref<HTMLElement | string>("body");
const hovered = reactive(new Set<string>());
const groups = computed(() =>
	notificationPlacements
		.map((placement) => ({ placement, notices: notificationStore.notices.filter((notice) => notice.placement === placement) }))
		.filter((group) => group.notices.length),
);
const icons: Record<NotificationKind, string> = {
	success: "CheckCircleFilled",
	error: "CloseCircleFilled",
	warning: "ExclamationCircleFilled",
	info: "InfoCircleFilled",
};
const Content = (props: { value: NotificationContent }): VNode | string => props.value;
let observer: MutationObserver | undefined;
let stack: HTMLDialogElement[] = [];
function updateTarget() {
	stack = stack.filter((dialog) => dialog.isConnected && dialog.open);
	target.value = stack[stack.length - 1] ?? document.body;
}
function noticeStyle(notice: NotificationEntry, index: number, total: number) {
	if (total <= 3 || hovered.has(notice.placement)) return undefined;
	return {
		position: "absolute" as const,
		top: notice.placement.startsWith("top") ? 0 : undefined,
		bottom: notice.placement.startsWith("bottom") ? 0 : undefined,
		transform:
			"translateY(" +
			(notice.placement.startsWith("bottom") ? -1 : 1) * Math.min(index, 2) * 8 +
			"px) scale(" +
			(1 - Math.min(index, 2) * 0.04) +
			")",
		zIndex: total - index,
		display: index > 2 ? "none" : undefined,
	};
}
onMounted(() => {
	stack = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
	updateTarget();
	observer = new MutationObserver((records) => {
		for (const record of records) {
			const dialog = record.target;
			if (!(dialog instanceof HTMLDialogElement)) continue;
			stack = stack.filter((item) => item !== dialog);
			if (dialog.open) stack.push(dialog);
		}
		updateTarget();
	});
	observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
	window.addEventListener("litellm-notification", receiveNotificationEvent);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	window.removeEventListener("litellm-notification", receiveNotificationEvent);
	notificationStore.clear();
});
</script>
<template>
	<Teleport :to="target"
		><div
			v-for="group in groups"
			:key="group.placement"
			class="notifications-placement"
			:class="[
				'notifications-placement--' + group.placement,
				{ 'notifications-placement--stacked': group.notices.length > 3 && !hovered.has(group.placement) },
			]"
			@mouseenter="hovered.add(group.placement)"
			@mouseleave="hovered.delete(group.placement)"
		>
			<article
				v-for="(notice, index) in group.notices"
				:key="notice.id"
				class="notification-notice"
				:class="[
					'notification-notice--' + notice.type,
					{ 'notification-notice--behind': index > 0 && group.notices.length > 3 && !hovered.has(group.placement) },
				]"
				:style="noticeStyle(notice, index, group.notices.length)"
				role="alert"
				@mouseenter="notificationStore.pause(notice.id)"
				@mouseleave="notificationStore.resume(notice.id)"
			>
				<UiIcon :name="icons[notice.type]" class="notification-notice__icon" :size="24" />
				<div class="notification-notice__message"><Content :value="notice.message" /></div>
				<div v-if="notice.description" class="notification-notice__description"><Content :value="notice.description" /></div>
				<button
					type="button"
					class="notification-notice__close"
					:aria-label="'Close ' + (typeof notice.message === 'string' ? notice.message : 'notification')"
					@click="notificationStore.close(notice.id)"
				>
					<UiIcon name="CloseOutlined" :size="14" />
				</button>
				<progress
					v-if="notice.duration > 0"
					class="notification-notice__progress"
					:max="100"
					:value="(notice.remaining / (notice.duration * 1000)) * 100"
					aria-label="Time remaining"
				/>
			</article></div
	></Teleport>
</template>
