<script setup lang="ts">
import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import type { LogsColumn } from "../support/LogsColumnModels";
import LogsTableCellComponent from "./LogsTableCellComponent.vue";
defineProps<{ log: LogEntry; columns: readonly LogsColumn[]; live: boolean }>();
defineEmits<{ select: [log: LogEntry]; key: [hash: string]; session: [group: SessionGroupRef] }>();
</script>
<template>
	<tr class="ui-table__row ui-table__row--clickable" @click="$emit('select', log)">
		<td v-for="column in columns" :key="column.id" :style="{ width: column.width + 'px' }">
			<LogsTableCellComponent
				:log="log"
				:column="column.id"
				:live="live"
				@key="$emit('key', $event)"
				@session="$emit('session', $event)"
			/>
		</td>
	</tr>
</template>
