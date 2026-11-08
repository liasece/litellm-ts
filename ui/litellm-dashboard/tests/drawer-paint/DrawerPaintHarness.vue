<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import UiDrawer from "../../src/features/platform/ui/UiDrawer.vue";
import UiDialog from "../../src/features/platform/ui/UiDialog.vue";
import DrawerPaintReference from "./DrawerPaintReference.vue";
import DrawerPaintContent from "./DrawerPaintContent.vue";
const params = new URLSearchParams(location.search);
const renderer = params.get("renderer") === "reference" ? "reference" : "native";
const placement = params.get("placement") === "left" ? "left" : "right";
const widthText = params.get("width") ?? "80vw";
const width = /^\d+$/.test(widthText) ? Number(widthText) : widthText;
const open = ref(false),
	parentOpen = ref(false),
	nestedOpen = ref(false),
	maskCanClose = ref(params.get("maskClosable") !== "false"),
	text = ref(""),
	nestedText = ref(""),
	backgroundClicks = ref(0);
const maskEvents = ref<{ trusted: boolean; x: number; y: number }[]>([]);
function recordMask(event: MouseEvent) {
	const target = event.target;
	if (!(target instanceof HTMLDialogElement) || !target.classList.contains("ui-drawer")) return;
	const rect = target.getBoundingClientRect();
	if (event.clientX < rect.left || event.clientX > rect.right)
		maskEvents.value.push({ trusted: event.isTrusted, x: event.clientX, y: event.clientY });
}
onMounted(() => document.addEventListener("click", recordMask, true));
onBeforeUnmount(() => document.removeEventListener("click", recordMask, true));
</script>
<template>
	<main class="paint-page">
		<h1>Drawer fixture</h1>
		<p>Unchanged ordinary page behind the modal.</p>
		<button type="button" @click="open = true">Open drawer</button>
		<button type="button" @click="parentOpen = true">Open parent</button>
		<button type="button" @click="backgroundClicks++">Background action</button>
		<p>Background action count: {{ backgroundClicks }}</p>
		<output hidden data-testid="mask-events">{{ JSON.stringify(maskEvents) }}</output>
	</main>
	<UiDrawer
		v-if="renderer === 'native'"
		v-model:open="open"
		:width="width"
		:placement="placement"
		:mask-closable="maskCanClose"
		title="Drawer paint"
		><DrawerPaintContent v-model="text" :mask-can-close="maskCanClose" @allow-mask="maskCanClose = true"
	/></UiDrawer>
	<DrawerPaintReference v-else v-model:open="open" :width="width" :placement="placement" title="Drawer paint"
		><DrawerPaintContent v-model="text"
	/></DrawerPaintReference>
	<UiDialog v-model:open="parentOpen" title="Parent overlay" scroll-mode="overlay" :width="520" :show-footer="false"
		><button type="button" @click="nestedOpen = true">Open inner drawer</button>
		<p>Parent content remains underneath its native child.</p></UiDialog
	>
	<UiDrawer v-model:open="nestedOpen" :width="720" placement="left" title="Nested drawer"
		><DrawerPaintContent v-model="nestedText"
	/></UiDrawer>
</template>
<style>
.paint-page {
	min-height: 100dvh;
	padding: 24px;
	color: #111827;
	font: 14px/22px var(--ui-font-antd);
}
.paint-page h1 {
	margin: 0 0 12px;
	font-size: 20px;
	line-height: 28px;
}
.paint-page p {
	margin: 12px 0;
}
.paint-page button {
	display: block;
	padding: 6px 12px;
	border: 1px solid #d9d9d9;
	border-radius: 6px;
	background: white;
	margin: 8px 0;
}
</style>
