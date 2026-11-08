<script setup lang="ts">
import { ref, useAttrs, type StyleValue } from "vue";
import UiIcon from "./UiIcon.vue";
import { useOverlayDialog } from "./overlay/OverlayLifecycle";

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const props = withDefaults(
	defineProps<{
		open: boolean;
		title?: string;
		width?: string | number;
		placement?: "right" | "left";
		closable?: boolean;
		maskClosable?: boolean;
		ariaLabel?: string;
	}>(),
	{ title: undefined, ariaLabel: undefined, width: "clamp(50vw, 1200px, 80vw)", placement: "right", closable: true, maskClosable: true },
);
const emit = defineEmits<{ "update:open": [open: boolean]; close: [] }>();
const dialog = ref<HTMLDialogElement>();
function dialogAttrs() {
	return { ...attrs, class: undefined, style: undefined };
}
function dialogStyle(): StyleValue {
	return [attrs.style as StyleValue, { width: typeof props.width === "number" ? props.width + "px" : props.width }];
}
function close() {
	emit("update:open", false);
	emit("close");
}
const { cancel } = useOverlayDialog(dialog, () => props.open, close);
function backdrop(event: MouseEvent) {
	if (!props.maskClosable || event.target !== dialog.value) return;
	const bounds = dialog.value?.getBoundingClientRect();
	if (bounds && (event.clientX < bounds.left || event.clientX > bounds.right)) close();
}
</script>

<template>
	<Teleport to="body"
		><dialog
			ref="dialog"
			v-bind="dialogAttrs()"
			class="ui-drawer"
			:class="['ui-drawer--' + placement, attrs.class]"
			:style="dialogStyle()"
			:aria-label="ariaLabel || title"
			@cancel="cancel"
			@click="backdrop"
		>
			<header class="ui-drawer__header">
				<div class="ui-drawer__header-title">
					<button v-if="closable" type="button" class="ui-overlay-close" aria-label="Close" @click="close">
						<span class="ui-drawer__close-icon" aria-hidden="true"><UiIcon name="CloseOutlined" :size="16" /></span>
					</button>
					<h2 class="ui-drawer__title">
						<slot name="title">{{ title }}</slot>
					</h2>
				</div>
				<div v-if="$slots.extra" class="ui-drawer__extra"><slot name="extra" /></div>
			</header>
			<div class="ui-drawer__body"><slot /></div>
			<footer v-if="$slots.footer" class="ui-drawer__footer"><slot name="footer" /></footer></dialog
	></Teleport>
</template>
