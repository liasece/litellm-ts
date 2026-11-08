<script setup lang="ts">
defineProps<{ name: "shield" | "check" | "fail" | "play" | "dot" | "download" | "chevron"; expanded?: boolean; size?: number }>();
</script>
<template>
	<svg v-if="name === 'shield'" :width="size || 40" :height="size || 40" viewBox="0 0 40 40" fill="none">
		<circle cx="20" cy="20" r="20" fill="#EEF2FF" />
		<path d="M20 10l8 4v6c0 5.25-3.4 10.15-8 11.5C15.4 30.15 12 25.25 12 20v-6l8-4z" stroke="#6366F1" stroke-width="1.5" fill="none" />
		<path d="M16 20l3 3 5-6" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	<svg v-else-if="name === 'download'" :width="size || 16" :height="size || 16" viewBox="0 0 16 16" fill="none">
		<path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	<svg
		v-else-if="name === 'chevron'"
		:width="size || 20"
		:height="size || 20"
		viewBox="0 0 20 20"
		fill="none"
		class="ld-guardrail-chevron"
		:style="{ transform: expanded ? 'rotate(180deg)' : undefined }"
	>
		<path d="M6 8l4 4 4-4" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	<svg v-else :width="size || 22" :height="size || 22" viewBox="0 0 22 22" fill="none">
		<circle v-if="name === 'dot'" cx="11" cy="11" r="5" fill="#9CA3AF" />
		<template v-else>
			<circle
				cx="11"
				cy="11"
				r="10"
				:stroke="name === 'check' ? '#16A34A' : name === 'fail' ? '#DC2626' : '#3B82F6'"
				stroke-width="1.5"
				:fill="name === 'check' ? '#F0FDF4' : name === 'fail' ? '#FEF2F2' : '#EFF6FF'"
			/>
			<path
				v-if="name === 'check'"
				d="M7 11l3 3 5-6"
				stroke="#16A34A"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path v-else-if="name === 'fail'" d="M8 8l6 6M14 8l-6 6" stroke="#DC2626" stroke-width="1.5" stroke-linecap="round" />
			<path v-else d="M9 7.5l6 3.5-6 3.5V7.5z" fill="#3B82F6" />
		</template>
	</svg>
</template>
