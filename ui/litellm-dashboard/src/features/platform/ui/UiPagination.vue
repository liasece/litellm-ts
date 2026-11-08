<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		modelValue: number;
		total: number;
		pageSize?: number;
		showSizeChanger?: boolean;
		pageSizeOptions?: readonly number[];
		showTotal?: boolean;
		disabled?: boolean;
	}>(),
	{ pageSize: 10, pageSizeOptions: () => [10, 20, 50, 100] },
);
const emit = defineEmits<{
	"update:modelValue": [page: number];
	"update:pageSize": [size: number];
	change: [page: number, size: number];
}>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const items = computed(() => {
	if (pages.value <= 7) return Array.from({ length: pages.value }, (_, index) => index + 1);
	const visible: (number | string)[] = [1];
	const start = Math.max(2, Math.min(props.modelValue - 2, pages.value - 4));
	const end = Math.min(pages.value - 1, Math.max(props.modelValue + 2, 5));
	if (start > 2) visible.push("previous");
	for (let page = start; page <= end; page++) visible.push(page);
	if (end < pages.value - 1) visible.push("next");
	visible.push(pages.value);
	return visible;
});
function change(page: number) {
	if (props.disabled) return;
	const next = Math.max(1, Math.min(page, pages.value));
	emit("update:modelValue", next);
	emit("change", next, props.pageSize);
}
function resize(event: Event) {
	const size = Number((event.target as HTMLSelectElement).value);
	const page = Math.min(props.modelValue, Math.max(1, Math.ceil(props.total / size)));
	emit("update:pageSize", size);
	emit("update:modelValue", page);
	emit("change", page, size);
}
</script>

<template>
	<nav class="ui-pagination" aria-label="Pagination">
		<span v-if="showTotal" class="ui-pagination__total"
			><slot
				name="total"
				:total="total"
				:from="total ? (modelValue - 1) * pageSize + 1 : 0"
				:to="Math.min(modelValue * pageSize, total)"
				>{{ total ? (modelValue - 1) * pageSize + 1 : 0 }}–{{ Math.min(modelValue * pageSize, total) }} of {{ total }} items</slot
			></span
		>
		<button
			type="button"
			class="ui-pagination__item"
			aria-label="Previous page"
			:disabled="disabled || modelValue <= 1"
			@click="change(modelValue - 1)"
		>
			‹
		</button>
		<template v-for="item in items" :key="item"
			><button
				v-if="typeof item === 'number'"
				type="button"
				class="ui-pagination__item"
				:class="{ 'ui-pagination__item--active': item === modelValue }"
				:disabled="disabled"
				:aria-label="'Page ' + item"
				:aria-current="item === modelValue ? 'page' : undefined"
				@click="change(item)"
			>
				{{ item }}</button
			><button
				v-else
				type="button"
				class="ui-pagination__item ui-pagination__jump"
				:disabled="disabled"
				:aria-label="item === 'previous' ? 'Previous 5 pages' : 'Next 5 pages'"
				@click="change(modelValue + (item === 'previous' ? -5 : 5))"
			>
				•••
			</button></template
		>
		<button
			type="button"
			class="ui-pagination__item"
			aria-label="Next page"
			:disabled="disabled || modelValue >= pages"
			@click="change(modelValue + 1)"
		>
			›
		</button>
		<select
			v-if="showSizeChanger"
			class="ui-pagination__size"
			:value="pageSize"
			:disabled="disabled"
			aria-label="Items per page"
			@change="resize"
		>
			<option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }} / page</option>
		</select>
	</nav>
</template>
