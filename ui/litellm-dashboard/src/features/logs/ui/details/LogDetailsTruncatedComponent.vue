<script setup lang="ts">
import { computed } from "vue";
import LogDetailsCopyComponent from "./LogDetailsCopyComponent.vue";
const props = withDefaults(defineProps<{ value: unknown; maxWidth?: number }>(), { maxWidth: 200 });
const text = computed(() => (props.value === undefined || props.value === null ? "-" : String(props.value)));
</script>
<template>
	<span class="ld-truncated" :style="{ maxWidth: maxWidth + 'px' }"
		><span :title="text">{{ text }}</span
		><LogDetailsCopyComponent v-if="value !== undefined && value !== null" :text="text"
	/></span>
</template>
