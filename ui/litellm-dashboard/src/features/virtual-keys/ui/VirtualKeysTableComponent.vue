<script setup lang="ts">
import { computed, onBeforeUnmount, reactive } from "vue";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTableSortLabel from "../../platform/ui/UiTableSortLabel.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { isTableRowInteractiveTarget } from "../../platform/logic/TableRowClick";
import { keyColumns, keyDate, type KeyColumn } from "../render/KeyTablePresentation";
import type { KeyCatalog, VirtualKey } from "../support/VirtualKeyModels";
import KeyModelsCell from "./KeyModelsCellComponent.vue";
import KeyUserCell from "./KeyUserCellComponent.vue";

const props = withDefaults(
	defineProps<{
		scope?: "global" | "team";
		rows: readonly VirtualKey[];
		catalog: KeyCatalog;
		loading: boolean;
		sortBy: string;
		sortOrder: "asc" | "desc";
		pendingToken?: string;
		canModify?: (key: VirtualKey) => boolean;
		filterFields?: Partial<Record<string, readonly UiTableFilterField[]>>;
		activeFilters?: readonly UiTableActiveFilter[];
	}>(),
	{ scope: "global", pendingToken: "", canModify: () => false, filterFields: () => ({}), activeFilters: () => [] },
);
const emit = defineEmits<{
	select: [key: VirtualKey];
	sort: [column: string];
	toggleEnabled: [key: VirtualKey, enabled: boolean];
	filterChange: [entries: readonly UiTableActiveFilter[]];
	removeFilter: [key: string];
	clearFilters: [];
}>();
const formatMoney = useMoneyFormatter();
const columns = computed(() =>
	props.scope === "team"
		? keyColumns.flatMap((column) =>
				column.key === "enabled" || column.key === "team_alias"
					? []
					: column.key === "user"
						? [
								{ key: "user_email", label: "User Email", width: 160 },
								{ key: "user_id", label: "User ID", width: 120 },
							]
						: column.key === "organization_alias"
							? [{ ...column, label: "Organization ID" }]
							: [column],
			)
		: keyColumns,
);
const widths = reactive<Record<string, number>>(
	Object.fromEntries(
		[...keyColumns, { key: "user_email", width: 160 }, { key: "user_id", width: 120 }].map((column) => [column.key, column.width]),
	),
);
const tableWidth = computed(() => columns.value.reduce((total, column) => total + widths[column.key], 0));
let resizeState: { key: string; x: number; width: number } | null = null;
function resize(event: PointerEvent, column: KeyColumn) {
	event.preventDefault();
	event.stopPropagation();
	resizeState = { key: column.key, x: event.clientX, width: widths[column.key] };
	document.addEventListener("pointermove", move);
	document.addEventListener("pointerup", finish, { once: true });
}
function move(event: PointerEvent) {
	if (resizeState) widths[resizeState.key] = Math.max(20, resizeState.width + event.clientX - resizeState.x);
}
function finish() {
	resizeState = null;
	document.removeEventListener("pointermove", move);
	document.removeEventListener("pointerup", finish);
}
/** 行级点击打开密钥详情；行内开关、按钮与工具提示自行处理。 */
function openRow(event: MouseEvent, key: VirtualKey): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("select", key);
}

function teamName(key: VirtualKey) {
	return key.team_id ? props.catalog.teams.find((team) => team.team_id === key.team_id)?.team_alias || key.team_id : "-";
}
function organizationName(key: VirtualKey) {
	const id = key.org_id ?? key.organization_id;
	return id ? props.catalog.organizations.find((org) => org.organization_id === id)?.organization_alias || id : "-";
}
function sortState(column: KeyColumn): "asc" | "desc" | false {
	return column.sortable && column.key === props.sortBy ? props.sortOrder : false;
}
function ariaSort(column: KeyColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sortable) return undefined;
	if (column.key !== props.sortBy) return "none";
	return props.sortOrder === "asc" ? "ascending" : "descending";
}
function filtersForColumn(key: string): readonly UiTableActiveFilter[] {
	const keys = new Set((props.filterFields[key] ?? []).map((field) => field.key));
	return props.activeFilters.filter((filter) => keys.has(filter.key));
}
const emptyText = computed(() => (props.activeFilters.length ? "No keys match the current filters" : "No keys found"));
onBeforeUnmount(finish);
</script>

<template>
	<div class="vk-table-viewport">
		<UiActiveFilters
			v-if="activeFilters.length"
			:filters="activeFilters"
			@remove="emit('removeFilter', $event)"
			@clear="emit('clearFilters')"
		/>
		<div class="vk-table-border">
			<div class="vk-table-scroll">
				<table class="vk-table" :style="{ minWidth: tableWidth + 'px' }">
					<thead>
						<tr>
							<th
								v-for="column in columns"
								:key="column.key"
								:data-header-id="column.key"
								:style="{ width: widths[column.key] + 'px' }"
								:aria-sort="ariaSort(column)"
							>
								<div class="vk-table-heading">
									<UiTableSortLabel
										v-if="column.sortable"
										:label="column.label"
										:state="sortState(column)"
										:allow-clear="false"
										@change="emit('sort', column.key)"
									/>
									<span v-else class="vk-table-heading__label">{{ column.label }}</span>
									<UiPopover v-if="column.tooltip" :content="column.tooltip"
										><UiIcon name="InfoCircleOutlined" class="vk-column-info"
									/></UiPopover>
									<UiHeaderFilterButton
										v-if="filterFields[column.key]?.length"
										:label="column.label"
										:fields="filterFields[column.key] ?? []"
										:active="filtersForColumn(column.key)"
										@change="emit('filterChange', $event)"
									/>
								</div>
								<div
									role="separator"
									aria-orientation="vertical"
									class="vk-column-resizer"
									@pointerdown="resize($event, column)"
									@click.stop
									@dblclick.stop="widths[column.key] = column.width"
								/>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="loading">
							<td :colspan="columns.length" class="vk-table-state">🚅 Loading keys...</td>
						</tr>
						<tr v-else-if="!rows.length">
							<td :colspan="columns.length" class="vk-table-state">{{ emptyText }}</td>
						</tr>
						<tr v-for="key in loading ? [] : rows" :key="key.token" class="vk-table-row" @click="openRow($event, key)">
							<td
								v-for="column in columns"
								:key="column.key"
								:style="{ width: widths[column.key] + 'px', maxWidth: widths[column.key] + 'px' }"
								:class="{ 'vk-models-many': column.key === 'models' && key.models.length > 3 }"
							>
								<UiTooltip v-if="column.key === 'token'" :title="key.token"
									><button
										type="button"
										class="vk-key-id"
										:style="{ maxWidth: widths[column.key] + 'px' }"
										@click="emit('select', key)"
									>
										{{ key.token || "-" }}
									</button></UiTooltip
								>
								<span v-else-if="column.key === 'key_alias'" class="vk-mono vk-truncate">{{ key.key_alias ?? "-" }}</span>
								<UiSwitch
									v-else-if="column.key === 'enabled'"
									:model-value="key.blocked !== true"
									:label="'Enabled ' + (key.key_alias || key.token)"
									:loading="pendingToken === key.token"
									:disabled="Boolean(pendingToken) || !canModify(key)"
									@update:model-value="emit('toggleEnabled', key, $event)"
									>{{ key.blocked === true ? "Disabled" : "Enabled" }}</UiSwitch
								>
								<span v-else-if="column.key === 'key_name'" class="vk-mono">{{ key.key_name }}</span>
								<template v-else-if="column.key === 'team_alias'">{{ teamName(key) }}</template>
								<template v-else-if="column.key === 'organization_alias'">{{
									scope === "team" ? key.organization_id || key.org_id || "-" : organizationName(key)
								}}</template>
								<template v-else-if="column.key === 'user_email'">{{
									key.user?.user_email ?? key.user_email ?? "-"
								}}</template>
								<KeyUserCell v-else-if="column.key === 'user_id'" :user-id="key.user_id" />
								<KeyUserCell
									v-else-if="column.key === 'user'"
									:user-id="key.user_id"
									:user-alias="key.user?.user_alias"
									:user-email="key.user?.user_email ?? key.user_email"
								/>
								<KeyUserCell
									v-else-if="column.key === 'created_by'"
									:user-id="key.created_by"
									:user-alias="key.created_by_user?.user_alias"
									:user-email="key.created_by_user?.user_email"
								/>
								<template v-else-if="column.key === 'created_at'">{{ keyDate(key.created_at, "-") }}</template>
								<template v-else-if="column.key === 'updated_at'">{{ keyDate(key.updated_at, "Never") }}</template>
								<UiTooltip
									v-else-if="column.key === 'last_active' && key.last_active"
									:title="new Date(key.last_active).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })"
									>{{ keyDate(key.last_active, "Unknown") }}</UiTooltip
								>
								<template v-else-if="column.key === 'last_active'">Unknown</template>
								<template v-else-if="column.key === 'expires'">{{ keyDate(key.expires, "Never") }}</template>
								<template v-else-if="column.key === 'spend'">{{ formatMoney(key.spend, 4) }}</template>
								<template v-else-if="column.key === 'max_budget'">{{
									key.max_budget === null ? "Unlimited" : formatMoney(key.max_budget, 4)
								}}</template>
								<template v-else-if="column.key === 'budget_reset_at'">{{
									key.budget_reset_at ? new Date(key.budget_reset_at).toLocaleString() : "Never"
								}}</template>
								<KeyModelsCell v-else-if="column.key === 'models'" :models="key.models" />
								<div v-else-if="column.key === 'rate_limits'">
									<div>TPM: {{ key.tpm_limit ?? "Unlimited" }}</div>
									<div>RPM: {{ key.rpm_limit ?? "Unlimited" }}</div>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>
