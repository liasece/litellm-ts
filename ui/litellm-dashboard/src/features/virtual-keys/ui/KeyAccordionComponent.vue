<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });
defineProps<{ title: string; large?: boolean; disabled?: boolean }>();
</script>
<!-- Original Tremor ArrowUpHeadIcon vector; see KeyAccordion.NOTICE. -->
<template>
	<details class="vk-accordion" :class="{ 'vk-accordion--large': large, 'vk-accordion--disabled': disabled }" :open="open">
		<summary @click.prevent="!disabled && (open = !open)">
			<div class="vk-accordion-heading">
				<slot name="title"
					><p v-if="large">{{ title }}</p>
					<b v-else>{{ title }}</b></slot
				>
			</div>
			<div class="vk-accordion-arrow">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M11.9999 10.8284L7.0502 15.7782L5.63599 14.364L11.9999 8L18.3639 14.364L16.9497 15.7782L11.9999 10.8284Z" />
				</svg>
			</div>
		</summary>
		<div v-if="open" class="vk-accordion-body"><slot /></div>
	</details>
</template>
