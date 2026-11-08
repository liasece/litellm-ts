<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import VectorTesterComponent from "./VectorTesterComponent.vue";
import type { VectorStore } from "../support/VectorStoreModels";
const props = defineProps<{ rows: VectorStore[] }>();
defineEmits<{ error: [message: string]; notice: [message: string] }>();
const id = ref(props.rows[0]?.vector_store_id);
</script>
<template>
	<UiCard v-if="!rows.length" appearance="antd" class="tools-vector-test-no-stores"
		>No vector stores available. Create one first to test it.</UiCard
	>
	<div v-else class="tools-vector-test-tab">
		<UiCard appearance="antd"
			><h5>Select Vector Store</h5>
			<p>Choose a vector store to test search queries against</p>
			<UiSelect
				v-model="id"
				:options="
					rows.map((row) => ({
						value: row.vector_store_id,
						label: row.vector_store_name || row.vector_store_id,
						description: row.vector_store_name ? row.vector_store_id : undefined,
					}))
				"
				placeholder="Select a vector store"
				size="large"
				searchable /></UiCard
		><VectorTesterComponent v-if="id" :id="id" @error="$emit('error', $event)" @notice="$emit('notice', $event)" />
	</div>
</template>
