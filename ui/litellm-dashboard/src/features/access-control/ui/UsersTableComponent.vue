<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableSort } from "../../platform/ui/UiTypes";
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
	width: number;
	sticky?: "right";
}
const columns: readonly UserColumn[] = [
	{ key: "user_id", label: "User ID", sortable: true, width: 170 },
	{ key: "user_email", label: "Email", sortable: true, width: 220 },
	{ key: "user_role", label: "Global Proxy Role", sortable: true, width: 150 },
	{ key: "user_alias", label: "User Alias", width: 140 },
	{ key: "teams", label: "Teams", width: 200 },
	{ key: "spend", label: "Spend", sortable: true, width: 130 },
	{ key: "max_budget", label: "Budget", width: 110 },
	{ key: "sso_user_id", label: "SSO ID", width: 120 },
	{ key: "key_count", label: "Virtual Keys", width: 110 },
	{ key: "created_at", label: "Created At", sortable: true, width: 120 },
	{ key: "updated_at", label: "Updated At", width: 120 },
	{ key: "actions", label: "Actions", width: 120, sticky: "right" },
];
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	columns.map((column) => ({
		key: column.key,
		label: column.label,
		width: column.width,
		sortable: column.sortable,
		initialSortOrder: column.key === "spend" ? "desc" : "asc",
		sticky: column.sticky,
		filters: props.filterFields[column.key],
	})),
);
const emptyText = computed(() => (props.activeFilters.length ? "No users match the current filters" : "No users found"));
/** 行级点击打开用户详情；行内按钮（复制/编辑/删除/重置）自行处理，不重复触发。 */
function openRow(event: MouseEvent, user: AccessUser): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("open", user);
}
function changeSort(next: UiTableSort): void {
	if (next.order) emit("sort", next.key, next.order);
}
function userRow(row: Record<string, unknown>): AccessUser {
	return row as unknown as AccessUser;
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
		<UiTable
			:columns="tableColumns"
			:rows="rows"
			row-key="user_id"
			:loading="loading"
			loading-text="🚅 Loading users..."
			fixed-layout
			mobile-cards
			:sort-by="sortBy || undefined"
			:sort-order="sortOrder"
			:sort-clearable="false"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			@sort="changeSort"
			@filter-change="emit('filterChange', $event)"
			@remove-filter="emit('removeFilter', $event)"
			@clear-filters="emit('clearFilters')"
		>
			<template #row="{ row }">
				<tr
					v-for="user in [userRow(row)]"
					:key="user.user_id"
					class="ui-table__row ui-table__row--clickable"
					@click="openRow($event, user)"
				>
					<td data-label="User ID" class="access-users-cell access-users-cell--id">
						<div class="access-user-id-cell">
							<button type="button" class="access-user-id" :title="user.user_id" @click="emit('open', user)">
								<span class="access-user-id-short">{{ user.user_id ? user.user_id.slice(0, 7) + "..." : "-" }}</span
								><span class="access-user-id-long">{{ user.user_id || "-" }}</span></button
							><UiTooltip v-if="user.user_id" title="Copy User ID"
								><button
									type="button"
									class="access-user-copy"
									aria-label="Copy User ID"
									:title="'Copy ' + user.user_id"
									@click.stop="copy(user.user_id)"
								>
									<UiIcon name="CopyOutlined" :size="12" /></button
							></UiTooltip>
						</div>
					</td>
					<td data-label="Email" class="access-users-cell access-users-cell--email">{{ user.user_email || "-" }}</td>
					<td data-label="Global Proxy Role" class="access-users-cell">
						{{ catalog.roles[user.user_role ?? ""]?.ui_label || "-" }}
					</td>
					<td data-label="User Alias" class="access-users-cell">{{ user.user_alias || "-" }}</td>
					<td data-label="Teams" class="access-users-cell access-users-cell--teams">
						<div v-if="userTeams(user).length" class="access-tags">
							<UiTag
								v-for="team in userTeams(user).slice(0, 2)"
								:key="team.team_id"
								appearance="tremor"
								size="xs"
								color="blue"
								:title="team.team_alias || team.team_id"
								>{{ team.team_alias || team.team_id }}</UiTag
							>
							<UiTag v-if="userTeams(user).length > 2" appearance="tremor" size="xs" color="gray"
								>+{{ userTeams(user).length - 2 }}</UiTag
							>
						</div>
						<span v-else>-</span>
					</td>
					<td data-label="Spend" class="access-users-cell">{{ user.spend ? money(user.spend, 4) : "-" }}</td>
					<td data-label="Budget" class="access-users-cell">
						{{ user.max_budget !== null ? money(user.max_budget) : "Unlimited" }}
					</td>
					<td data-label="SSO ID" class="access-users-cell">{{ user.sso_user_id !== null ? user.sso_user_id : "-" }}</td>
					<td data-label="Virtual Keys" class="access-users-cell">
						<UiTag appearance="tremor" size="xs" :color="user.key_count && user.key_count > 0 ? 'indigo' : 'gray'">{{
							user.key_count && user.key_count > 0
								? user.key_count + " " + (user.key_count === 1 ? "Key" : "Keys")
								: "No Keys"
						}}</UiTag>
					</td>
					<td data-label="Created At" class="access-users-cell">
						{{ user.created_at ? new Date(user.created_at).toLocaleDateString() : "-" }}
					</td>
					<td data-label="Updated At" class="access-users-cell">
						{{ user.updated_at ? new Date(user.updated_at).toLocaleDateString() : "-" }}
					</td>
					<td data-label="Actions" class="access-users-actions ui-table__cell--sticky-right">
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
			</template>
		</UiTable>
	</div>
</template>
