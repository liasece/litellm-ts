<script setup lang="ts">
import PolicyHeroIconComponent from "./PolicyHeroIconComponent.vue";
defineProps<{ label: string; order?: "asc" | "desc" | null }>();
defineEmits<{ sort: [event: MouseEvent] }>();
</script>
<template>
	<button type="button" class="policy-sort-header" @click="$emit('sort', $event)">
		<span>{{ label }}</span
		><PolicyHeroIconComponent
			:name="order === 'asc' ? 'ChevronUp' : order === 'desc' ? 'ChevronDown' : 'SwitchVertical'"
			:size="16"
			:class="{ 'is-sorted': order }"
		/>
	</button>
</template>
