<script setup lang="ts">
import { computed } from "vue";
import { LOGS_PAGE_SIZE_OPTIONS } from "../support/LogsConstants";
const props = defineProps<{ currentPage: number; pageSize: number; total: number; totalPages: number; loading: boolean }>();
const emit = defineEmits<{ page: [value: number]; size: [value: number] }>();
const first = computed(() => (props.total > 0 ? (props.currentPage - 1) * props.pageSize + 1 : 0));
const last = computed(() => Math.min(props.currentPage * props.pageSize, props.total));
</script>
<template>
	<div class="logs-pagination">
		<span class="logs-result-count"
			>Showing {{ loading ? "..." : first }} - {{ loading ? "..." : last }} of {{ loading ? "..." : total }} results</span
		>
		<div class="logs-pagination-controls">
			<label for="logs-page-size">Logs per page</label>
			<select
				id="logs-page-size"
				class="logs-native-select"
				:value="pageSize"
				@change="emit('size', Number(($event.target as HTMLSelectElement).value))"
			>
				<option v-for="size in LOGS_PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
			</select>
			<span class="logs-page-count">Page {{ loading ? "..." : currentPage }} of {{ loading ? "..." : totalPages || 1 }}</span>
			<button
				type="button"
				class="logs-native-button"
				:disabled="loading || currentPage === 1"
				@click="emit('page', Math.max(1, currentPage - 1))"
			>
				Previous
			</button>
			<button
				type="button"
				class="logs-native-button"
				:disabled="loading || currentPage === (totalPages || 1)"
				@click="emit('page', Math.min(totalPages || 1, currentPage + 1))"
			>
				Next
			</button>
		</div>
	</div>
</template>
