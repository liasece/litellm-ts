<script setup lang="ts">
defineProps<{ page: number; totalPages: number; total: number; compact?: boolean }>();
const emit = defineEmits<{ change: [page: number] }>();
</script>
<template>
	<div class="tool-policy-pagination" :class="{ compact }">
		<span
			>Showing {{ total === 0 ? 0 : (page - 1) * 50 + 1 }} - {{ Math.min(page * 50, total) }} of {{ total
			}}{{ compact ? "" : " results" }}</span
		><span v-if="!compact">Page {{ page }} of {{ totalPages }}</span>
		<div>
			<button type="button" :disabled="page === 1" @click="emit('change', Math.max(1, page - 1))">Previous</button
			><button type="button" :disabled="page === totalPages" @click="emit('change', Math.min(totalPages, page + 1))">Next</button>
		</div>
	</div>
</template>
