<script setup lang="ts">
import { ref, useAttrs, type StyleValue } from "vue";
import UiButton from "./UiButton.vue";
import UiIcon from "./UiIcon.vue";
import { useOverlayDialog } from "./overlay/OverlayLifecycle";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		open: boolean;
		title?: string;
		width?: string | number;
		centered?: boolean;
		closable?: boolean;
		maskClosable?: boolean;
		okText?: string;
		cancelText?: string;
		confirmLoading?: boolean;
		showFooter?: boolean;
		ariaLabel?: string;
		scrollMode?: "overlay" | "content";
	}>(),
	{
		title: undefined,
		ariaLabel: undefined,
		width: 520,
		closable: true,
		maskClosable: true,
		okText: "OK",
		cancelText: "Cancel",
		showFooter: true,
		scrollMode: "content",
	},
);
const emit = defineEmits<{ "update:open": [open: boolean]; cancel: []; ok: [] }>();
const attrs = useAttrs();
const dialog = ref<HTMLDialogElement>();
const panel = ref<HTMLElement>();
function close() {
	emit("update:open", false);
	emit("cancel");
}
const { cancel } = useOverlayDialog(
	dialog,
	() => props.open,
	close,
	(outer) => {
		// AntD focuses its start sentinel without moving either of the modal's scroll containers.
		panel.value?.focus({ preventScroll: true });
		if (props.scrollMode !== "overlay") return;
		outer.scrollTop = 0;
		if (panel.value) panel.value.scrollTop = 0;
	},
);
function outerAttrs() {
	return { ...attrs, class: undefined, style: undefined };
}
function panelStyle(): StyleValue {
	return [attrs.style as StyleValue, { width: typeof props.width === "number" ? props.width + "px" : props.width }];
}
function backdrop(event: MouseEvent) {
	if (!props.maskClosable || event.target !== dialog.value) return;
	const bounds = (props.scrollMode === "overlay" ? panel.value : dialog.value)?.getBoundingClientRect();
	if (
		bounds &&
		(event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
	)
		close();
}
</script>

<template>
	<Teleport to="body">
		<dialog
			ref="dialog"
			v-bind="outerAttrs()"
			:class="
				scrollMode === 'overlay'
					? ['ui-dialog-overlay', { 'ui-dialog-overlay--centered': centered }]
					: ['ui-dialog', attrs.class, { 'ui-dialog--centered': centered }]
			"
			:style="scrollMode === 'content' ? panelStyle() : undefined"
			:aria-label="ariaLabel || title"
			@cancel="cancel"
			@click="backdrop"
		>
			<div
				ref="panel"
				:tabindex="-1"
				:class="scrollMode === 'overlay' ? ['ui-dialog', 'ui-dialog--overlay-panel', attrs.class] : undefined"
				:style="scrollMode === 'overlay' ? panelStyle() : undefined"
			>
				<button v-if="closable" type="button" class="ui-overlay-close ui-dialog__close" aria-label="Close" @click="close">
					<UiIcon name="CloseOutlined" :size="16" />
				</button>
				<header v-if="title || $slots.title" class="ui-dialog__header">
					<h2 class="ui-dialog__title">
						<slot name="title">{{ title }}</slot>
					</h2>
				</header>
				<div class="ui-dialog__body"><slot /></div>
				<footer v-if="showFooter" class="ui-dialog__footer">
					<slot name="footer"
						><UiButton @click="close">{{ cancelText }}</UiButton
						><UiButton variant="primary" :loading="confirmLoading" @click="emit('ok')">{{ okText }}</UiButton></slot
					>
				</footer>
			</div>
		</dialog>
	</Teleport>
</template>
