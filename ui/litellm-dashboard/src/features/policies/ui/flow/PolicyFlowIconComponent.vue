<script setup lang="ts">
defineProps<{ type: "guardrail" | "play" | "end" | "pass" | "fail" }>();
</script>
<template>
	<span v-if="type === 'guardrail' || type === 'play' || type === 'end'" class="policy-flow-icon" :class="'policy-flow-icon--' + type">
		<svg
			v-if="type === 'guardrail'"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#6366f1"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 8v4" />
		</svg>
		<svg v-else-if="type === 'play'" width="12" height="12" viewBox="0 0 24 24" fill="#6b7280" stroke="none">
			<polygon points="6,3 20,12 6,21" />
		</svg>
		<svg
			v-else
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#6b7280"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<line x1="8" y1="12" x2="16" y2="12" /></svg
	></span>
	<svg
		v-else
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		:stroke="type === 'pass' ? '#22c55e' : '#f87171'"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="policy-flow-outcome-icon"
	>
		<circle cx="12" cy="12" r="10" />
		<path v-if="type === 'pass'" d="M9 12l2 2 4-4" />
	</svg>
</template>
