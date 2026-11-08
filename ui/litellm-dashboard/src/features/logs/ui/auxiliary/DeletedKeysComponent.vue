<script setup lang="ts">
import "./DeletedLogsStyles.css";
import { onBeforeUnmount, onMounted } from "vue";
import { createDeletedLogsStore } from "../../stores/DeletedLogsStore";
import { deletedKeyColumns } from "../../support/DeletedLogColumnModels";
import DeletedRecordsTableComponent from "./DeletedRecordsTableComponent.vue";
const store = createDeletedLogsStore("keys");
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="deleted-log-section">
		<div class="deleted-log-header">
			<span v-if="store.state.loading || store.state.fetching">Loading...</span
			><span v-else
				>Showing {{ (store.state.page - 1) * 50 + 1 }} - {{ Math.min(store.state.page * 50, store.state.total) }} of
				{{ store.state.total }} results</span
			>
			<div class="deleted-log-pages">
				<span v-if="store.state.loading || store.state.fetching">Loading...</span
				><span v-else>Page {{ store.state.page }} of {{ store.pages.value }}</span
				><button
					class="logs-native-button"
					:disabled="store.state.loading || store.state.fetching || store.state.page === 1"
					@click="store.page(store.state.page - 1)"
				>
					Previous</button
				><button
					class="logs-native-button"
					:disabled="store.state.loading || store.state.fetching || store.state.page >= store.pages.value"
					@click="store.page(store.state.page + 1)"
				>
					Next
				</button>
			</div>
		</div>
		<DeletedRecordsTableComponent
			:rows="store.rows.value"
			:columns="deletedKeyColumns"
			:loading="store.state.loading || store.state.fetching"
			kind="keys"
		/>
	</div>
</template>
