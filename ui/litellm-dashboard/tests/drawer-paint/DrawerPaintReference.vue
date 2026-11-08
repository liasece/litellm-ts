<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import UiIcon from "../../src/features/platform/ui/UiIcon.vue";
const open = defineModel<boolean>("open", { default: false });
defineProps<{ width: string | number; placement: "left" | "right"; title: string }>();
const closeButton = ref<HTMLButtonElement>();
let overflow = "";
watch(open, async (value) => {
	if (value) {
		overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		await nextTick();
		closeButton.value?.focus({ preventScroll: true });
	} else document.body.style.overflow = overflow;
});
onBeforeUnmount(() => {
	if (open.value) document.body.style.overflow = overflow;
});
</script>
<template>
	<Teleport to="body"
		><div v-if="open" class="paint-reference-root">
			<div class="paint-reference-mask" @click="open = false" />
			<div
				class="paint-reference-panel"
				:class="{ 'paint-reference-panel--left': placement === 'left' }"
				:style="{ width: typeof width === 'number' ? width + 'px' : width }"
			>
				<div class="paint-reference-content" role="dialog" :aria-label="title">
					<header class="ui-drawer__header">
						<div class="ui-drawer__header-title">
							<button ref="closeButton" class="ui-overlay-close" type="button" aria-label="Close" @click="open = false">
								<span class="ui-drawer__close-icon" aria-hidden="true"><UiIcon name="CloseOutlined" :size="16" /></span>
							</button>
							<h2 class="ui-drawer__title">{{ title }}</h2>
						</div>
					</header>
					<div class="ui-drawer__body"><slot /></div>
				</div>
			</div></div
	></Teleport>
</template>
<style>
/* Independent old AntD ordinary-DOM paint reference: no ui-drawer root, custom paint token or pseudo rules. */
.paint-reference-root {
	position: fixed;
	inset: 0;
	z-index: 1000;
	pointer-events: none;
}
.paint-reference-mask {
	position: absolute;
	inset: 0;
	z-index: 1000;
	pointer-events: auto;
	background: rgba(0, 0, 0, 0.45);
}
.paint-reference-panel {
	position: absolute;
	inset: 0 0 0 auto;
	margin: 0;
	padding: 0;
	border: 0;
	min-width: 0;
	max-width: 100vw;
	height: 100dvh;
	max-height: 100dvh;
	z-index: 1000;
	background: transparent;
	color: rgba(0, 0, 0, 0.88);
	font: 14px/22px var(--ui-font-antd);
	box-shadow:
		-6px 0 16px 0 rgba(0, 0, 0, 0.08),
		-3px 0 6px -4px rgba(0, 0, 0, 0.12),
		-9px 0 28px 8px rgba(0, 0, 0, 0.05);
}
.paint-reference-panel--left {
	inset: 0 auto 0 0;
	box-shadow:
		6px 0 16px 0 rgba(0, 0, 0, 0.08),
		3px 0 6px -4px rgba(0, 0, 0, 0.12),
		9px 0 28px 8px rgba(0, 0, 0, 0.05);
}
.paint-reference-content {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	overflow: auto;
	background: white;
	pointer-events: auto;
}
</style>
