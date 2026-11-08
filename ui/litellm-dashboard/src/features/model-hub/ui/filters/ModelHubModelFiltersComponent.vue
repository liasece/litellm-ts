<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { HubModel } from "../../support/ModelHubModels";
import { filterHubModels, uniqueFeatures, uniqueModes, uniqueProviders } from "../../logic/ModelHubFilterLogic";
import UiCard from "../../../platform/ui/UiCard.vue";
const props = withDefaults(defineProps<{ models: HubModel[]; card?: boolean }>(), { card: true }),
	emit = defineEmits<{ change: [HubModel[]] }>(),
	state = reactive({ search: "", provider: "", mode: "", feature: "" }),
	filtered = computed(() =>
		filterHubModels(
			props.models,
			state.search,
			state.provider ? [state.provider] : [],
			state.mode ? [state.mode] : [],
			state.feature ? [state.feature] : [],
		),
	);
watch(filtered, (rows) => emit("change", rows), { immediate: true });
function clear() {
	Object.assign(state, { search: "", provider: "", mode: "", feature: "" });
}
</script>
<template>
	<component :is="card ? UiCard : 'div'" appearance="tremor" class="hub-model-filters" :class="{ 'hub-model-filters--plain': !card }">
		<div>
			<label>Search Models:</label><input v-model="state.search" placeholder="Search model names..." aria-label="Search Models" />
		</div>
		<div>
			<label>Provider:</label
			><select v-model="state.provider" aria-label="Provider">
				<option value="">All Providers</option>
				<option v-for="provider in uniqueProviders(models)" :key="provider">{{ provider }}</option>
			</select>
		</div>
		<div>
			<label>Mode:</label
			><select v-model="state.mode" aria-label="Mode">
				<option value="">All Modes</option>
				<option v-for="mode in uniqueModes(models)" :key="mode">{{ mode }}</option>
			</select>
		</div>
		<div>
			<label>Features:</label
			><select v-model="state.feature" aria-label="Features">
				<option value="">All Features</option>
				<option v-for="feature in uniqueFeatures(models)" :key="feature">{{ feature }}</option>
			</select>
		</div>
		<div v-if="state.search || state.provider || state.mode || state.feature">
			<button type="button" @click="clear">Clear Filters</button>
		</div>
	</component>
</template>
<style>
.hub-model-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	align-items: center;
	margin-bottom: 24px;
}
.hub-model-filters--plain {
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	padding: 16px;
	background: #f9fafb;
	margin: 0;
}
.hub-model-filters label {
	display: block;
	font-size: 14px;
	font-weight: 500;
	line-height: 20px;
	color: #6b7280;
	margin-bottom: 8px;
}
.hub-model-filters input,
.hub-model-filters select {
	height: 40px;
	border: 1px solid #6b7280;
	border-radius: 4px;
	padding: 8px 12px;
	font-family: inherit;
	font-size: 14px;
	line-height: 20px;
	background: #fff;
	color: #4b5563;
}
.hub-model-filters input {
	width: 256px;
	color: #000;
}
.hub-model-filters select[aria-label="Provider"] {
	width: 160px;
}
.hub-model-filters select[aria-label="Mode"] {
	width: 128px;
}
.hub-model-filters select[aria-label="Features"] {
	width: 192px;
}
.hub-model-filters button {
	align-self: flex-end;
	height: 40px;
	background: none;
	border: 0;
	padding: 0;
	font-size: 14px;
	color: #2563eb;
	text-decoration: underline;
	cursor: pointer;
}

.hub-model-filters input::placeholder {
	color: #6b7280;
	opacity: 1;
}
.hub-model-filters select {
	appearance: none;
	background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
	background-position: right 8px center;
	background-repeat: no-repeat;
	background-size: 1.5em 1.5em;
}
</style>
