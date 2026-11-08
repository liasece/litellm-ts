<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = withDefaults(defineProps<{ label?: string; defaultOpen?: boolean; bodyClass?: string }>(), {
	label: undefined,
	defaultOpen: false,
	bodyClass: undefined,
});
const expanded = ref(props.defaultOpen);
</script>
<template>
	<section class="ld-collapse">
		<div class="ld-collapse__header">
			<button
				type="button"
				class="ld-collapse__toggle"
				:aria-label="label || 'Toggle section'"
				:aria-expanded="expanded"
				@click="expanded = !expanded"
			>
				<UiIcon :name="expanded ? 'DownOutlined' : 'RightOutlined'" />
			</button>
			<div class="ld-collapse__label" @click="expanded = !expanded">
				<slot name="label"
					><h3>{{ label }}</h3></slot
				>
			</div>
		</div>
		<div v-show="expanded" class="ld-collapse__body" :class="bodyClass"><slot /></div>
	</section>
</template>
