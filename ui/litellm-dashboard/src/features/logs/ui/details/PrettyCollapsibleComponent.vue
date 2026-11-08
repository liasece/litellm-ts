<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = withDefaults(defineProps<{ label?: string; defaultOpen?: boolean; lazy?: boolean; maxHeight?: number }>(), {
	label: undefined,
	defaultOpen: false,
	lazy: false,
	maxHeight: 2000,
});
const expanded = ref(props.defaultOpen);
</script>
<template>
	<div class="pretty-collapsible">
		<button type="button" class="pretty-collapsible__toggle" :aria-expanded="expanded" @click="expanded = !expanded">
			<UiIcon :name="expanded ? 'DownOutlined' : 'RightOutlined'" /><slot name="label"
				><span class="pretty-label">{{ label }}</span></slot
			>
		</button>
		<div class="pretty-collapsible__animation" :style="{ maxHeight: expanded ? maxHeight + 'px' : '0px', opacity: expanded ? 1 : 0 }">
			<div v-if="!lazy || expanded" class="pretty-collapsible__body"><slot /></div>
		</div>
	</div>
</template>
