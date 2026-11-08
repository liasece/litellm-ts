<script setup lang="ts">
import "./DeletedLogsStyles.css";
import { onBeforeUnmount, onMounted } from "vue";
import { createDeletedLogsStore } from "../../stores/DeletedLogsStore";
import { deletedTeamColumns } from "../../support/DeletedLogColumnModels";
import DeletedRecordsTableComponent from "./DeletedRecordsTableComponent.vue";
const store = createDeletedLogsStore("teams");
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="deleted-log-section">
		<div class="deleted-log-header">
			<span v-if="store.state.loading || store.state.fetching">Loading...</span
			><span v-else>Showing {{ store.rows.value.length }} team{{ store.rows.value.length === 1 ? "" : "s" }}</span>
		</div>
		<DeletedRecordsTableComponent
			:rows="store.rows.value"
			:columns="deletedTeamColumns"
			:loading="store.state.loading || store.state.fetching"
			kind="teams"
		/>
	</div>
</template>
