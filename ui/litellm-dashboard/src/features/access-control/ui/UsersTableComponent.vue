<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiTableSortLabel from "../../platform/ui/UiTableSortLabel.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { AccessCatalog, AccessTeam, AccessUser } from "../support/AccessModels";
import { isTableRowInteractiveTarget } from "../../platform/logic/TableRowClick";
const props = withDefaults(
	defineProps<{
		rows: AccessUser[];
		loading: boolean;
		catalog: AccessCatalog;
		sortBy: string;
		sortOrder: "asc" | "desc";
		filterFields?: Partial<Record<string, readonly UiTableFilterField[]>>;
		activeFilters?: readonly UiTableActiveFilter[];
	}>(),
	{ filterFields: () => ({}), activeFilters: () => [] },
);
const emit = defineEmits<{
	open: [user: AccessUser, edit?: boolean];
	delete: [user: AccessUser];
	sort: [key: string, order: "asc" | "desc"];
	filterChange: [entries: readonly UiTableActiveFilter[]];
	removeFilter: [key: string];
	clearFilters: [];
}>();
const money = useMoneyFormatter();
interface UserColumn {
	key: string;
	label: string;
	sortable?: boolean;
	width?: number;
}
const columns: readonly UserColumn[] = [
	{ key: "user_id", label: "User ID", sortable: true },
	{ key: "user_email", label: "Email", sortable: true },
	{ key: "user_role", label: "Global Proxy Role", sortable: true },
	{ key: "user_alias", label: "User Alias" },
	{ key: "teams", label: "Teams" },
	{ key: "spend", label: "Spend", sortable: true },
	{ key: "max_budget", label: "Budget" },
	{ key: "sso_user_id", label: "SSO ID", width: 87.05 },
	{ key: "key_count", label: "Virtual Keys" },
	{ key: "created_at", label: "Created At", sortable: true },
	{ key: "updated_at", label: "Updated At" },
	{ key: "actions", label: "Actions" },
];
const emptyText = computed(() => (props.activeFilters.length ? "No users match the current filters" : "No users found"));
/** 行级点击打开用户详情；行内按钮（复制/编辑/删除/重置）自行处理，不重复触发。 */
function openRow(event: MouseEvent, user: AccessUser): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("open", user);
}
function initialOrder(key: string): "asc" | "desc" {
	return key === "spend" ? "desc" : "asc";
}
function sortState(column: UserColumn): "asc" | "desc" | false {
	return column.sortable && props.sortBy === column.key ? props.sortOrder : false;
}
function ariaSort(column: UserColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sortable) return undefined;
	if (props.sortBy !== column.key) return "none";
	return props.sortOrder === "asc" ? "ascending" : "descending";
}
function changeSort(key: string, order: "asc" | "desc" | false): void {
	if (order) emit("sort", key, order);
}
function filtersForColumn(key: string): readonly UiTableActiveFilter[] {
	const keys = new Set((props.filterFields[key] ?? []).map((field) => field.key));
	return props.activeFilters.filter((filter) => keys.has(filter.key));
}
function userTeams(user: AccessUser): AccessTeam[] {
	return (user.teams ?? [])
		.map((id) => props.catalog.teams.find((team) => team.team_id === id))
		.filter((team): team is AccessTeam => Boolean(team));
}
function copy(id: string) {
	void copyText(id).catch(() => undefined);
}
</script>
<template>
	<div class="access-users-table-section">
		<UiActiveFilters
			v-if="activeFilters.length"
			:filters="activeFilters"
			@remove="emit('removeFilter', $event)"
			@clear="emit('clearFilters')"
		/>
		<div class="access-users-table-wrap">
			<table class="access-users-table">
				<thead>
					<tr>
						<th
							v-for="column in columns"
							:key="column.key"
							:class="{ 'access-users-actions': column.key === 'actions' }"
							:aria-sort="ariaSort(column)"
						>
							<div class="access-users-heading">
								<UiTableSortLabel
									v-if="column.sortable"
									:label="column.label"
									:state="sortState(column)"
									:initial="initialOrder(column.key)"
									:allow-clear="false"
									@change="changeSort(column.key, $event)"
								/>
								<span v-else class="access-users-heading__label">{{ column.label }}</span>
								<UiHeaderFilterButton
									v-if="filterFields[column.key]?.length"
									:label="column.label"
									:fields="filterFields[column.key] ?? []"
									:active="filtersForColumn(column.key)"
									@change="emit('filterChange', $event)"
								/>
							</div>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading">
						<td :colspan="columns.length" class="access-users-empty">🚅 Loading users...</td>
					</tr>
					<tr v-for="user in loading ? [] : rows" :key="user.user_id" class="access-users-row" @click="openRow($event, user)">
						<td>
							<div class="access-user-id-cell">
								<button type="button" class="access-user-id" :title="user.user_id" @click="emit('open', user)">
									{{ user.user_id ? user.user_id.slice(0, 7) + "..." : "-" }}</button
								><UiTooltip v-if="user.user_id" title="Copy User ID"
									><button
										type="button"
										class="access-user-copy"
										aria-label="Copy User ID"
										@click.stop="copy(user.user_id)"
									>
										<UiIcon name="CopyOutlined" :size="12" /></button
								></UiTooltip>
							</div>
						</td>
						<td>{{ user.user_email || "-" }}</td>
						<td>{{ catalog.roles[user.user_role ?? ""]?.ui_label || "-" }}</td>
						<td>{{ user.user_alias || "-" }}</td>
						<td>
							<div v-if="userTeams(user).length" class="access-tags">
								<UiTag
									v-for="team in userTeams(user).slice(0, 2)"
									:key="team.team_id"
									appearance="tremor"
									size="xs"
									color="blue"
									>{{ team.team_alias || team.team_id }}</UiTag
								>
								<UiTag v-if="userTeams(user).length > 2" appearance="tremor" size="xs" color="gray"
									>+{{ userTeams(user).length - 2 }}</UiTag
								>
							</div>
							<span v-else>-</span>
						</td>
						<td>{{ user.spend ? money(user.spend, 4) : "-" }}</td>
						<td>{{ user.max_budget !== null ? money(user.max_budget) : "Unlimited" }}</td>
						<td>{{ user.sso_user_id !== null ? user.sso_user_id : "-" }}</td>
						<td>
							<UiTag appearance="tremor" size="xs" :color="user.key_count && user.key_count > 0 ? 'indigo' : 'gray'">{{
								user.key_count && user.key_count > 0
									? user.key_count + " " + (user.key_count === 1 ? "Key" : "Keys")
									: "No Keys"
							}}</UiTag>
						</td>
						<td>{{ user.created_at ? new Date(user.created_at).toLocaleDateString() : "-" }}</td>
						<td>{{ user.updated_at ? new Date(user.updated_at).toLocaleDateString() : "-" }}</td>
						<td class="access-users-actions">
							<div class="access-tags">
								<button
									type="button"
									class="access-users-row-action"
									title="Edit user details"
									aria-label="Edit user details"
									@click="emit('open', user, true)"
								>
									<AccessHeroIconComponent name="PencilAlt" :size="20" /></button
								><button
									type="button"
									class="access-users-row-action"
									title="Delete user"
									aria-label="Delete user"
									@click="emit('delete', user)"
								>
									<AccessHeroIconComponent name="Trash" :size="20" />
								</button>
							</div>
						</td>
					</tr>
					<tr v-if="!loading && !rows.length">
						<td :colspan="columns.length" class="access-users-empty">{{ emptyText }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
