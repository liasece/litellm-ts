<script setup lang="ts" generic="T extends Record<string, unknown>">
import { computed, onBeforeUnmount, ref } from "vue";
import ModelHubHeroIconComponent from "./ModelHubHeroIconComponent.vue";
import type { HubColumn } from "../../support/ModelHubModels";
defineSlots<
	Record<`cell-${string}`, (props: { row: T; value: unknown; index: number }) => unknown> &
		Record<`header-${string}`, (props: { column: HubColumn<T> }) => unknown>
>();
type CellSlot = `cell-${string}`;
type HeaderSlot = `header-${string}`;
function cellSlot(key: string): CellSlot {
	return ("cell-" + key) as CellSlot;
}
function headerSlot(key: string): HeaderSlot {
	return ("header-" + key) as HeaderSlot;
}
const props = withDefaults(
	defineProps<{ rows: T[]; columns: HubColumn<T>[]; loading?: boolean; defaultSort?: string; rowKey?: string }>(),
	{ defaultSort: "", rowKey: "" },
);
const sort = ref<{ key: string; desc: boolean }[]>(props.defaultSort ? [{ key: props.defaultSort, desc: false }] : []),
	widths = ref<Record<string, number>>({});
function value(row: T, key: string): unknown {
	return key
		.split(".")
		.reduce<unknown>(
			(current, part) => (current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined),
			row,
		);
}
function compare(column: HubColumn<T>, a: T, b: T) {
	if (column.compare) return column.compare(a, b);
	const av = value(a, column.dataIndex && typeof column.dataIndex === "string" ? column.dataIndex : column.key),
		bv = value(b, column.dataIndex && typeof column.dataIndex === "string" ? column.dataIndex : column.key);
	if (typeof av === "number" && typeof bv === "number") return av - bv;
	const as = Array.isArray(av) ? av.join(", ") : String(av ?? ""),
		bs = Array.isArray(bv) ? bv.join(", ") : String(bv ?? "");
	return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}
const sorted = computed(() =>
	props.rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			for (const item of sort.value) {
				const column = props.columns.find((column) => column.key === item.key);
				if (column) {
					const comparison = compare(column, a.row, b.row);
					if (comparison) return item.desc ? -comparison : comparison;
				}
			}
			return a.index - b.index;
		})
		.map((item) => item.row),
);
function width(column: HubColumn<T>) {
	return widths.value[column.key] ?? Number(column.width ?? 150);
}
const total = computed(() => props.columns.reduce((sum, column) => sum + width(column), 0));
function order(key: string) {
	return sort.value.find((item) => item.key === key);
}
function toggle(column: HubColumn<T>, event: MouseEvent) {
	if (!column.sortable) return;
	const current = order(column.key),
		firstDesc = column.numeric === true;
	const next = !current
		? { key: column.key, desc: firstDesc }
		: current.desc === firstDesc
			? { key: column.key, desc: !firstDesc }
			: null;
	sort.value = [...(event.shiftKey ? sort.value.filter((item) => item.key !== column.key) : []), ...(next ? [next] : [])];
}
let cleanup: (() => void) | undefined;
function resize(column: HubColumn<T>, event: MouseEvent | TouchEvent) {
	event.stopPropagation();
	event.preventDefault();
	cleanup?.();
	const start = "touches" in event ? event.touches[0]?.clientX : event.clientX;
	if (start === undefined) return;
	const initial = width(column);
	function move(event: MouseEvent | TouchEvent) {
		const x = "touches" in event ? event.touches[0]?.clientX : event.clientX;
		if (x !== undefined) widths.value = { ...widths.value, [column.key]: Math.max(40, Math.min(500, initial + x - start)) };
	}
	function end() {
		cleanup?.();
		cleanup = undefined;
	}
	window.addEventListener("mousemove", move);
	window.addEventListener("mouseup", end);
	window.addEventListener("touchmove", move, { passive: false });
	window.addEventListener("touchend", end);
	cleanup = () => {
		window.removeEventListener("mousemove", move);
		window.removeEventListener("mouseup", end);
		window.removeEventListener("touchmove", move);
		window.removeEventListener("touchend", end);
	};
}
onBeforeUnmount(() => cleanup?.());
function label(row: T, column: HubColumn<T>) {
	const result = value(row, column.key);
	return typeof result === "string" || typeof result === "number" ? result : result == null ? "" : JSON.stringify(result);
}
</script>
<template>
	<div class="hub-data-table">
		<div class="hub-data-table__scroll">
			<table :style="{ width: total + 'px', minWidth: '100%', tableLayout: 'fixed' }">
				<thead>
					<tr>
						<th
							scope="col"
							:aria-label="column.label"
							v-for="column in columns"
							:key="column.key"
							:style="{ width: width(column) + 'px' }"
							:class="[
								column.hiddenBelow ? 'hub-column--' + column.hiddenBelow : '',
								column.align ? 'hub-align--' + column.align : '',
							]"
							:aria-sort="
								order(column.key)
									? order(column.key)?.desc
										? 'descending'
										: 'ascending'
									: column.sortable
										? 'none'
										: undefined
							"
							@click="toggle(column, $event)"
						>
							<div>
								<span
									><slot :name="headerSlot(column.key)" :column="column">{{ column.label }}</slot></span
								><span v-if="column.sortable" class="hub-data-table__sort" :class="{ 'is-active': order(column.key) }">
									<ModelHubHeroIconComponent
										:name="
											!order(column.key) ? 'SwitchVertical' : order(column.key)?.desc ? 'ChevronDown' : 'ChevronUp'
										"
										:size="16"
									/>
								</span>
							</div>
							<div
								class="hub-data-table__resize"
								role="separator"
								aria-orientation="vertical"
								:aria-label="'Resize ' + column.label + ' column'"
								@mousedown="resize(column, $event)"
								@touchstart="resize(column, $event)"
								@click.stop
							/>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading">
						<td :colspan="columns.length" class="hub-data-table__empty">🚅 Loading models...</td>
					</tr>
					<template v-else-if="sorted.length"
						><tr v-for="(row, index) in sorted" :key="rowKey ? String(value(row, rowKey)) : index">
							<td
								v-for="column in columns"
								:key="column.key"
								:style="{ width: width(column) + 'px' }"
								:class="[
									column.hiddenBelow ? 'hub-column--' + column.hiddenBelow : '',
									column.align ? 'hub-align--' + column.align : '',
								]"
							>
								<slot :name="cellSlot(column.key)" :row="row" :value="value(row, column.key)" :index="index">{{
									label(row, column)
								}}</slot>
							</td>
						</tr></template
					>
					<tr v-else>
						<td :colspan="columns.length" class="hub-data-table__empty">No models found</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
<style>
.hub-data-table {
	border: 1px solid #dcddeb;
	border-radius: 8px;
	position: relative;
}
.hub-data-table__scroll {
	overflow-x: auto;
}
.hub-data-table table {
	border-collapse: collapse;
	color: #6b7280;
	font-size: 12.4px;
	line-height: 18.4px;
	text-align: left;
}
.hub-data-table th {
	position: relative;
	padding: 8px 16px;
	height: 32px;
	font-weight: 600;
	color: #111827;
	border: 0;
	white-space: nowrap;
}
.hub-data-table th > div:first-child {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.hub-data-table th > div:first-child > span:first-child {
	display: flex;
	align-items: center;
}
.hub-data-table td {
	padding: 8px 16px;
	overflow: hidden;
	white-space: nowrap;
	vertical-align: middle;
	border-bottom: 1px solid #e5e7eb;
}
.hub-data-table tr:last-child td {
	border-bottom: 0;
}
.hub-data-table__sort {
	display: flex;
	flex: 0 1 auto;
	width: 16px;
	min-width: 0;
	color: #9ca3af;
}
.hub-data-table__sort svg {
	width: 16px;
	height: 16px;
}
.hub-data-table__sort.is-active {
	color: #3b82f6;
}
.hub-data-table__resize {
	position: absolute;
	right: 0;
	top: 0;
	height: 100%;
	width: 8px;
	cursor: col-resize;
	user-select: none;
	touch-action: none;
}
.hub-data-table__resize:hover {
	background: #bfdbfe;
}
.hub-data-table td.hub-data-table__empty {
	height: 32px;
	text-align: center;
}
.hub-data-table .hub-align--center {
	text-align: center;
}
.hub-data-table .hub-align--right {
	text-align: right;
}
@media (max-width: 767px) {
	.hub-data-table .hub-column--md {
		display: none;
	}
}
@media (max-width: 1023px) {
	.hub-data-table .hub-column--lg {
		display: none;
	}
}
@media (max-width: 1279px) {
	.hub-data-table .hub-column--xl {
		display: none;
	}
}
</style>
