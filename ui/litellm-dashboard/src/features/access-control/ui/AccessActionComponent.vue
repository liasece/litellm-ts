<script setup lang="ts">
import { computed, useAttrs } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
defineOptions({ inheritAttrs: false });
const props = defineProps<{ name: string; label: string; danger?: boolean; disabled?: boolean; appearance?: "antd" | "tremor" }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>(),
	attrs = useAttrs();
const hero = computed(() => (({ SquarePen: "PencilAlt", Trash2: "Trash", Copy: "ClipboardCopy" }) as Record<string, string>)[props.name]);
</script>
<template>
	<UiTooltip :title="label"
		><button
			v-bind="attrs"
			type="button"
			class="access-icon-action"
			:class="{ 'access-icon-action--danger': danger, 'access-icon-action--tremor': appearance === 'tremor' }"
			:aria-label="label"
			:disabled="disabled"
			@click="emit('click', $event)"
		>
			<AccessHeroIconComponent v-if="hero" :name="hero" :size="20" /><UiLucideIcon v-else :name="name" :size="16" /></button
	></UiTooltip>
</template>
