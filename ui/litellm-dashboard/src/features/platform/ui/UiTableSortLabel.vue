<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		label: string;
		state?: "asc" | "desc" | false;
		initial?: "asc" | "desc";
		/** 为 false 时在升序/降序之间切换，不再提供“取消排序”。 */
		allowClear?: boolean;
		/** 表头已通过 th 的 aria-sort 暴露排序状态时，按钮使用简洁名称。 */
		hasSortArrows?: boolean;
		disabled?: boolean;
	}>(),
	{ state: false, initial: "asc", allowClear: true, hasSortArrows: false, disabled: false },
);
const emit = defineEmits<{ change: [value: "asc" | "desc" | false] }>();

const next = computed<"asc" | "desc" | false>(() => {
	if (!props.state) return props.initial;
	const alternate = props.state === "asc" ? "desc" : "asc";
	if (!props.allowClear) return alternate;
	return props.state === props.initial ? alternate : false;
});
const description = computed(() => {
	const direction = (value: "asc" | "desc") => (value === "asc" ? "ascending" : "descending");
	if (!props.state) return props.label + ", not sorted. Activate to sort " + direction(props.initial) + ".";
	const following = next.value ? "sort " + direction(next.value) : props.allowClear ? "remove sorting" : "keep sorting";
	return props.label + ", sorted " + direction(props.state) + ". Activate to " + following + ".";
});
function change(): void {
	if (!props.disabled) emit("change", next.value);
}
</script>

<template>
	<button
		type="button"
		class="ui-table-sort-label"
		:class="{ 'is-sorted': Boolean(state) }"
		:aria-label="hasSortArrows ? description : undefined"
		:aria-description="hasSortArrows ? undefined : description"
		:title="description"
		:disabled="disabled"
		@click.stop="change"
	>
		<span class="ui-table-sort-label__text"
			><slot>{{ label }}</slot></span
		>
		<span class="ui-table__sort-arrows" aria-hidden="true"
			><span :class="{ 'is-active': state === 'asc' }">▴</span><span :class="{ 'is-active': state === 'desc' }">▾</span></span
		>
	</button>
</template>
