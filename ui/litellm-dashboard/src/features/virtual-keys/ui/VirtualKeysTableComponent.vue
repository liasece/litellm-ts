<script setup lang="ts">
import { computed } from "vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { keyColumns, keyDate } from "../render/KeyTablePresentation";
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
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	columns.value.map((column) => ({
		key: column.key,
		label: column.label,
		width: column.width,
		sortable: column.sortable,
		tooltip: column.tooltip,
		filters: props.filterFields[column.key],
	})),
);
function teamName(key: VirtualKey) {
	return key.team_id ? props.catalog.teams.find((team) => team.team_id === key.team_id)?.team_alias || key.team_id : "-";
}
function organizationName(key: VirtualKey) {
	const id = key.org_id ?? key.organization_id;
	return id ? props.catalog.organizations.find((org) => org.organization_id === id)?.organization_alias || id : "-";
}
const emptyText = computed(() => (props.activeFilters.length ? "No keys match the current filters" : "No keys found"));
function localeDate(value: unknown): string {
	return value ? new Date(String(value)).toLocaleString() : "Never";
}
function keyRow(row: UiTableRow): VirtualKey {
	return row as unknown as VirtualKey;
}
</script>

<template>
	<div class="vk-table-viewport">
		<UiTable
			:columns="tableColumns"
			:rows="rows"
			row-key="token"
			:loading="loading"
			loading-text="🚅 Loading keys..."
			:active-filters="activeFilters"
			:empty-text="emptyText"
			fixed-layout
			resizable
			sticky-header
			:sort-clearable="false"
			:sort-by="sortBy"
			:sort-order="sortOrder"
			@sort="emit('sort', $event.key)"
			@filter-change="emit('filterChange', $event)"
			@remove-filter="emit('removeFilter', $event)"
			@clear-filters="emit('clearFilters')"
		>
			<template #row="{ row }">
				<tr class="ui-table__row ui-table__row--clickable" @click="emit('select', keyRow(row))">
					<td
						v-for="column in columns"
						:key="column.key"
						:class="{ 'vk-models-many': column.key === 'models' && keyRow(row).models.length > 3 }"
					>
						<UiTooltip v-if="column.key === 'token'" :title="keyRow(row).token"
							><button type="button" class="vk-key-id" @click.stop="emit('select', keyRow(row))">
								{{ keyRow(row).token || "-" }}
							</button></UiTooltip
						>
						<span v-else-if="column.key === 'key_alias'" class="vk-mono vk-truncate">{{ keyRow(row).key_alias ?? "-" }}</span>
						<UiSwitch
							v-else-if="column.key === 'enabled'"
							:model-value="keyRow(row).blocked !== true"
							:label="'Enabled ' + (keyRow(row).key_alias || keyRow(row).token)"
							:loading="pendingToken === keyRow(row).token"
							:disabled="Boolean(pendingToken) || !canModify(keyRow(row))"
							@update:model-value="emit('toggleEnabled', keyRow(row), $event)"
							>{{ keyRow(row).blocked === true ? "Disabled" : "Enabled" }}</UiSwitch
						>
						<span v-else-if="column.key === 'key_name'" class="vk-mono">{{ keyRow(row).key_name }}</span>
						<template v-else-if="column.key === 'team_alias'">{{ teamName(keyRow(row)) }}</template>
						<template v-else-if="column.key === 'organization_alias'">{{
							scope === "team" ? keyRow(row).organization_id || keyRow(row).org_id || "-" : organizationName(keyRow(row))
						}}</template>
						<template v-else-if="column.key === 'user_email'">{{
							keyRow(row).user?.user_email ?? keyRow(row).user_email ?? "-"
						}}</template>
						<KeyUserCell v-else-if="column.key === 'user_id'" :user-id="keyRow(row).user_id" />
						<KeyUserCell
							v-else-if="column.key === 'user'"
							:user-id="keyRow(row).user_id"
							:user-alias="keyRow(row).user?.user_alias"
							:user-email="keyRow(row).user?.user_email ?? keyRow(row).user_email"
						/>
						<KeyUserCell
							v-else-if="column.key === 'created_by'"
							:user-id="keyRow(row).created_by"
							:user-alias="keyRow(row).created_by_user?.user_alias"
							:user-email="keyRow(row).created_by_user?.user_email"
						/>
						<template v-else-if="column.key === 'created_at'">{{ keyDate(keyRow(row).created_at, "-") }}</template>
						<template v-else-if="column.key === 'updated_at'">{{ keyDate(keyRow(row).updated_at, "Never") }}</template>
						<UiTooltip
							v-else-if="column.key === 'last_active' && keyRow(row).last_active"
							:title="
								new Date(keyRow(row).last_active ?? '').toLocaleString(undefined, {
									dateStyle: 'medium',
									timeStyle: 'long',
								})
							"
							>{{ keyDate(keyRow(row).last_active, "Unknown") }}</UiTooltip
						>
						<template v-else-if="column.key === 'last_active'">Unknown</template>
						<template v-else-if="column.key === 'expires'">{{ keyDate(keyRow(row).expires, "Never") }}</template>
						<template v-else-if="column.key === 'spend'">{{ formatMoney(keyRow(row).spend, 4) }}</template>
						<template v-else-if="column.key === 'max_budget'">{{
							keyRow(row).max_budget === null ? "Unlimited" : formatMoney(keyRow(row).max_budget, 4)
						}}</template>
						<template v-else-if="column.key === 'budget_reset_at'">{{ localeDate(keyRow(row).budget_reset_at) }}</template>
						<KeyModelsCell v-else-if="column.key === 'models'" :models="keyRow(row).models" />
						<div v-else-if="column.key === 'rate_limits'">
							<div>TPM: {{ keyRow(row).tpm_limit ?? "Unlimited" }}</div>
							<div>RPM: {{ keyRow(row).rpm_limit ?? "Unlimited" }}</div>
						</div>
					</td>
				</tr>
			</template>
		</UiTable>
	</div>
</template>
