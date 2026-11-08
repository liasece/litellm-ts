<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { messageStore } from "../stores/MessageStore";
import type { MessageKind } from "../support/MessageModels";
const icons: Record<MessageKind, string> = {
	success: "CheckCircleFilled",
	error: "CloseCircleFilled",
	warning: "ExclamationCircleFilled",
	info: "InfoCircleFilled",
	loading: "LoadingOutlined",
};
const target = ref<HTMLElement | string>("body");
let observer: MutationObserver | undefined,
	stack: HTMLDialogElement[] = [];
function update() {
	stack = stack.filter((dialog) => dialog.isConnected && dialog.open);
	target.value = stack[stack.length - 1] ?? document.body;
}
onMounted(() => {
	stack = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
	update();
	observer = new MutationObserver((records) => {
		for (const record of records) {
			const dialog = record.target;
			if (!(dialog instanceof HTMLDialogElement)) continue;
			stack = stack.filter((item) => item !== dialog);
			if (dialog.open) stack.push(dialog);
		}
		update();
	});
	observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
});
onBeforeUnmount(() => {
	observer?.disconnect();
	messageStore.clear();
});
</script>
<template>
	<Teleport :to="target"
		><div v-if="messageStore.entries.length" class="message-layer">
			<div v-for="entry in messageStore.entries" :key="entry.id" class="message-notice" role="alert">
				<div class="message-notice-content">
					<div class="message-notice-body" :class="'message-notice-body--' + entry.type">
						<UiIcon
							:name="icons[entry.type]"
							:size="16"
							:class="{ 'message-notice-loading': entry.type === 'loading' }"
						/><span>{{ entry.content }}</span>
					</div>
				</div>
			</div>
		</div></Teleport
	>
</template>
<style>
.message-layer {
	position: fixed;
	top: 8px;
	left: 0;
	width: 100%;
	margin: 0;
	padding: 0;
	z-index: 2010;
	pointer-events: none;
	box-sizing: border-box;
	color: rgba(0, 0, 0, 0.88);
	font: 14px/22px var(--ui-font-antd);
	overflow-wrap: break-word;
}
.message-notice {
	padding: 8px;
	text-align: center;
}
.message-notice-content {
	display: inline-block;
	padding: 9px 12px;
	background: #fff;
	border-radius: 8px;
	box-shadow:
		0 6px 16px 0 rgba(0, 0, 0, 0.08),
		0 3px 6px -4px rgba(0, 0, 0, 0.12),
		0 9px 28px 8px rgba(0, 0, 0, 0.05);
	pointer-events: auto;
}
.message-notice-body {
	display: flex;
	align-items: center;
}
.message-notice-body > .ui-icon {
	margin-inline-end: 8px;
	flex-shrink: 0;
}
.message-notice-body--success > .ui-icon {
	color: #52c41a;
}
.message-notice-body--error > .ui-icon {
	color: #ff4d4f;
}
.message-notice-body--warning > .ui-icon {
	color: #faad14;
}
.message-notice-body--info > .ui-icon,
.message-notice-body--loading > .ui-icon {
	color: #1677ff;
}
.message-notice-loading {
	animation: message-loading-spin 1s linear infinite;
}
@keyframes message-loading-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
