<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry, LogsOptionalColumnId, LogsSortField, SessionGroupRef } from "../support/LogsModels";
import { logsColumns } from "../support/LogsColumnModels";
import LogsTableRowComponent from "./LogsTableRowComponent.vue";
import LogsSortComponent from "./LogsSortComponent.vue";
const props = withDefaults(
	defineProps<{
		data: LogEntry[];
		loading: boolean;
		sortBy: LogsSortField;
		sortOrder: "asc" | "desc";
		visibleColumns?: LogsOptionalColumnId[];
		live: boolean;
	}>(),
	{ visibleColumns: () => [] },
);
defineEmits<{
	select: [log: LogEntry];
	key: [hash: string];
	session: [group: SessionGroupRef];
	sort: [field: LogsSortField, order: "asc" | "desc"];
}>();
const columns = computed(() => logsColumns(props.visibleColumns));
const width = computed(() => columns.value.reduce((sum, item) => sum + item.width, 0));
</script>
<template>
	<div class="logs-table-wrap">
		<table class="logs-table" :style="{ minWidth: width + 'px' }">
			<thead>
				<tr>
					<th v-for="column in columns" :key="column.id" :style="{ width: column.width + 'px' }">
						<LogsSortComponent
							v-if="column.sort"
							:label="column.label"
							:state="sortBy === column.sort ? sortOrder : false"
							@change="$emit('sort', $event ? column.sort! : 'startTime', $event || 'desc')"
						/><span v-else>{{ column.label }}</span>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="loading" class="logs-empty">
					<td :colspan="columns.length">🚅 Loading logs...</td>
				</tr>
				<LogsTableRowComponent
					v-for="log in loading ? [] : data"
					:key="log.request_id"
					:log="log"
					:columns="columns"
					:live="live"
					@select="$emit('select', $event)"
					@key="$emit('key', $event)"
					@session="$emit('session', $event)"
				/>
				<tr v-if="!loading && data.length === 0" class="logs-empty">
					<td :colspan="columns.length">No logs found</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
