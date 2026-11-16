<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = withDefaults(defineProps<{ label?: string; defaultOpen?: boolean; bodyClass?: string }>(), {
	label: undefined,
	defaultOpen: false,
	bodyClass: undefined,
});
const expanded = ref(props.defaultOpen);
function toggle(): void {
	expanded.value = !expanded.value;
}
/** 标题栏整行都是点击区域；内嵌按钮（如 Pretty/JSON）自己处理点击，不能顺带折叠。 */
function onHeaderClick(event: MouseEvent): void {
	const target = event.target;
	if (!(target instanceof Element)) return;
	if (target.closest("button, a, input, select, textarea, summary, [role='button'], [role='link']")) return;
	toggle();
}
</script>
<template>
	<section class="ld-collapse">
		<div class="ld-collapse__header" @click="onHeaderClick">
			<button
				type="button"
				class="ld-collapse__toggle"
				:aria-label="label || 'Toggle section'"
				:aria-expanded="expanded"
				@click="toggle"
			>
				<UiIcon :name="expanded ? 'DownOutlined' : 'RightOutlined'" />
			</button>
			<div class="ld-collapse__label">
				<slot name="label"
					><h3>{{ label }}</h3></slot
				>
			</div>
		</div>
		<div v-show="expanded" class="ld-collapse__body" :class="bodyClass"><slot /></div>
	</section>
</template>
