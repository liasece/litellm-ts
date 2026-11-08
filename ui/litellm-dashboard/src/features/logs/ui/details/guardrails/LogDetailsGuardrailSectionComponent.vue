<script setup lang="ts">
import { ref } from "vue";
const props = withDefaults(defineProps<{ title: string; count?: number; defaultOpen?: boolean }>(), {
	count: undefined,
	defaultOpen: true,
});
const expanded = ref(props.defaultOpen);
</script>
<template>
	<section class="ld-guardrail-section">
		<button type="button" :aria-expanded="expanded" @click="expanded = !expanded">
			<span class="ld-inline"
				><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :style="{ transform: expanded ? 'rotate(90deg)' : undefined }">
					<path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
				><span
					>{{ title }} <span v-if="count !== undefined" class="ld-secondary">({{ count }})</span></span
				></span
			><slot name="right" />
		</button>
		<div v-if="expanded" class="ld-guardrail-section__body"><slot /></div>
	</section>
</template>
