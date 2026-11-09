<script setup lang="ts">
import type { UiTableActiveFilter } from "./UiTableFilterModels";

withDefaults(defineProps<{ filters: readonly UiTableActiveFilter[]; clearLabel?: string }>(), { clearLabel: "Clear all" });
const emit = defineEmits<{ remove: [key: string]; clear: [] }>();
</script>

<template>
	<div v-if="filters.length" class="ui-active-filters" role="list" aria-label="Active filters">
		<span v-for="filter in filters" :key="filter.key" class="ui-active-filters__chip" role="listitem">
			<span class="ui-active-filters__label">{{ filter.label }}</span>
			<span class="ui-active-filters__value" :title="filter.text">{{ filter.text }}</span>
			<button
				type="button"
				class="ui-active-filters__remove"
				:aria-label="'Remove ' + filter.label + ' filter'"
				@click="emit('remove', filter.key)"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
					<path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
				</svg>
			</button>
		</span>
		<button type="button" class="ui-active-filters__clear" @click="emit('clear')">{{ clearLabel }}</button>
	</div>
</template>
