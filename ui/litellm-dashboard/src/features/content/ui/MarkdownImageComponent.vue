<script setup lang="ts">
import { computed, ref } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useOverlayDialog } from "../../platform/ui/overlay/OverlayLifecycle";
import { isLocalImagePath } from "../logic/MarkdownLogic";
import "./MarkdownImageStyles.css";
const props = withDefaults(defineProps<{ src?: string; alt?: string; title?: string; preview?: boolean; localFallback?: boolean }>(), {
	src: undefined,
	alt: "",
	title: undefined,
	preview: false,
	localFallback: false,
});
const open = ref(false),
	dialog = ref<HTMLDialogElement>(),
	zoom = ref(1),
	rotation = ref(0),
	flipX = ref(1),
	flipY = ref(1),
	pan = ref({ x: 0, y: 0 }),
	dragging = ref(false);
const unavailable = computed(() => props.localFallback && (!props.src || isLocalImagePath(props.src)));
const { cancel } = useOverlayDialog(
	dialog,
	() => open.value,
	() => (open.value = false),
);
let dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
function show() {
	if (!props.preview) return;
	zoom.value = 1;
	rotation.value = 0;
	flipX.value = 1;
	flipY.value = 1;
	pan.value = { x: 0, y: 0 };
	open.value = true;
}
function scale(factor: number) {
	zoom.value = Math.max(1, Math.min(50, zoom.value * factor));
	if (zoom.value === 1) pan.value = { x: 0, y: 0 };
}
function startDrag(event: PointerEvent) {
	if (event.button !== 0) return;
	event.preventDefault();
	dragging.value = true;
	dragStart = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y };
	if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
}
function drag(event: PointerEvent) {
	if (!dragStart) return;
	pan.value = { x: dragStart.panX + event.clientX - dragStart.x, y: dragStart.panY + event.clientY - dragStart.y };
}
function stopDrag() {
	dragStart = null;
	dragging.value = false;
}
function wheel(event: WheelEvent) {
	event.preventDefault();
	scale(event.deltaY < 0 ? 1.5 : 1 / 1.5);
}
function backdrop(event: MouseEvent) {
	if (
		event.target === dialog.value ||
		(event.target instanceof HTMLElement && event.target.classList.contains("markdown-image-preview__viewport"))
	)
		open.value = false;
}
function doubleClick() {
	zoom.value = zoom.value === 1 ? 2 : 1;
	pan.value = { x: 0, y: 0 };
}
</script>
<template>
	<span v-if="unavailable" class="markdown-image-unavailable"
		><span v-if="alt" class="markdown-image-unavailable__label">{{ alt }}</span
		><span>{{
			src && isLocalImagePath(src) ? "图片保存在生成设备上，日志中没有可显示的图片数据。" : "日志中的图片地址或数据不可用。"
		}}</span></span
	>
	<span v-else class="markdown-image" :class="{ 'markdown-image--preview': preview }"
		><button v-if="preview" type="button" class="markdown-image__trigger" :aria-label="'预览图片 ' + (alt || '图片')" @click="show">
			<img :src="src" :alt="alt || '图片'" :title="title" /><span class="markdown-image__mask"
				><UiIcon name="EyeOutlined" /> Preview</span
			></button
		><img v-else :src="src" :alt="alt" :title="title" />
		<Teleport v-if="preview" to="body"
			><dialog
				ref="dialog"
				class="markdown-image-preview"
				aria-label="Image preview"
				@cancel="cancel"
				@click="backdrop"
				@wheel="wheel"
			>
				<div class="markdown-image-preview__viewport">
					<img
						:src="src"
						:alt="alt || '图片'"
						draggable="false"
						:class="{ 'markdown-image-preview__image--dragging': dragging }"
						:style="{
							transform:
								'translate(' +
								pan.x +
								'px,' +
								pan.y +
								'px) scale(' +
								zoom +
								') rotate(' +
								rotation +
								'deg) scaleX(' +
								flipX +
								') scaleY(' +
								flipY +
								')',
						}"
						@pointerdown="startDrag"
						@pointermove="drag"
						@pointerup="stopDrag"
						@pointercancel="stopDrag"
						@dblclick="doubleClick"
					/>
				</div>
				<button
					type="button"
					class="markdown-image-preview__close"
					title="Close"
					aria-label="Close image preview"
					@click="open = false"
				>
					<UiIcon name="CloseOutlined" />
				</button>
				<div class="markdown-image-preview__toolbar">
					<button type="button" title="Flip vertically" aria-label="Flip vertically" @click="flipY *= -1">
						<UiIcon name="SwapOutlined" style="transform: rotate(90deg)" /></button
					><button type="button" title="Flip horizontally" aria-label="Flip horizontally" @click="flipX *= -1">
						<UiIcon name="SwapOutlined" /></button
					><button type="button" title="Rotate left" aria-label="Rotate left" @click="rotation -= 90">
						<UiIcon name="RotateLeftOutlined" /></button
					><button type="button" title="Rotate right" aria-label="Rotate right" @click="rotation += 90">
						<UiIcon name="RotateRightOutlined" /></button
					><button type="button" title="Zoom out" aria-label="Zoom out" :disabled="zoom <= 1" @click="scale(1 / 1.5)">
						<UiIcon name="ZoomOutOutlined" /></button
					><button type="button" title="Zoom in" aria-label="Zoom in" :disabled="zoom >= 50" @click="scale(1.5)">
						<UiIcon name="ZoomInOutlined" />
					</button>
				</div></dialog
		></Teleport>
	</span>
</template>
