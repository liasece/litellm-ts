<script setup lang="ts">
import { ref } from "vue";
import UiDragHandle from "../../src/features/platform/ui/UiDragHandle.vue";
import UiEntryCard from "../../src/features/platform/ui/UiEntryCard.vue";
import UiSortableList from "../../src/features/platform/ui/UiSortableList.vue";
import UiSortableRow from "../../src/features/platform/ui/UiSortableRow.vue";

const items = ref(["Alpha", "Beta", "Gamma"]),
	chain = ref(["first", "second", "third"]);
</script>

<template>
	<section data-testid="sortable-fixture">
		<UiSortableList
			data-testid="sortable-card-list"
			:items="items"
			:item-key="(item) => item"
			:label="(index, total) => 'target ' + (index + 1) + ' of ' + total"
			@update:items="items = $event"
		>
			<template #item="{ item, index, itemProps, itemClass, handleProps }">
				<UiEntryCard :index="index + 1" :class="itemClass" v-bind="itemProps">
					<template #handle><UiDragHandle v-bind="handleProps" /></template>
					<template #title>{{ item }}</template>
				</UiEntryCard>
			</template>
		</UiSortableList>
		<output data-testid="sortable-order">{{ items.join(",") }}</output>
		<!-- 内联表单用同一个拖拽状态，但排成紧凑行：这里确认行内把手的键盘改序也生效。 -->
		<UiSortableList
			data-testid="sortable-row-list"
			:items="chain"
			:item-key="(row) => row"
			:label="(index, total) => 'fallback ' + (index + 1) + ' of ' + total"
			@update:items="chain = $event"
		>
			<template #item="{ item, index, itemProps, itemClass, handleProps }">
				<UiSortableRow :index="index + 1" :class="itemClass" v-bind="itemProps">
					<template #handle><UiDragHandle v-bind="handleProps" /></template>
					{{ item }}
				</UiSortableRow>
			</template>
		</UiSortableList>
		<output data-testid="sortable-row-order">{{ chain.join(",") }}</output>
	</section>
</template>
