<script setup lang="ts">
import { copyText } from "../../content/logic/ClipboardLogic";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessCatalog, AccessUser } from "../support/AccessModels";
import { isTableRowInteractiveTarget } from "../../platform/logic/TableRowClick";
const props = defineProps<{
	rows: AccessUser[];
	loading: boolean;
	catalog: AccessCatalog;
	sortBy: string;
	sortOrder: "asc" | "desc";
}>();
const emit = defineEmits<{
	open: [user: AccessUser, edit?: boolean];
	delete: [user: AccessUser];
	sort: [key: string, order: "asc" | "desc"];
}>();
const money = useMoneyFormatter();

/** 行级点击打开用户详情；行内按钮（复制/编辑/删除/重置）自行处理，不重复触发。 */
function openRow(event: MouseEvent, user: AccessUser): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("open", user);
}
const columns = [
	{ key: "user_id", label: "User ID", sortable: true },
	{ key: "user_email", label: "Email", sortable: true },
	{ key: "user_role", label: "Global Proxy Role", sortable: true },
	{ key: "user_alias", label: "User Alias" },
	{ key: "spend", label: "Spend", sortable: true },
	{ key: "max_budget", label: "Budget" },
	{ key: "sso_user_id", label: "SSO ID", width: 87.05 },
	{ key: "key_count", label: "Virtual Keys" },
	{ key: "created_at", label: "Created At", sortable: true },
	{ key: "updated_at", label: "Updated At" },
	{ key: "actions", label: "Actions" },
];
function sort(key: string) {
	const first = typeof props.rows[0]?.[key] === "string" ? "asc" : "desc";
	if (props.sortBy !== key) {
		emit("sort", key, first);
		return;
	}
	if (props.sortOrder === first) emit("sort", key, first === "asc" ? "desc" : "asc");
	else emit("sort", "created_at", "desc");
}
function copy(id: string) {
	void copyText(id).catch(() => undefined);
}
</script>
<template>
	<div class="access-users-table-wrap">
		<table class="access-users-table">
			<thead>
				<tr>
					<th
						v-for="column in columns"
						:key="column.key"
						:class="{ 'access-users-actions': column.key === 'actions' }"
						:aria-sort="
							column.sortable
								? sortBy === column.key
									? sortOrder === 'asc'
										? 'ascending'
										: 'descending'
									: 'none'
								: undefined
						"
					>
						<button v-if="column.sortable" type="button" class="access-user-sort" @click="sort(column.key)">
							<span>{{ column.label }}</span
							><AccessHeroIconComponent
								:name="sortBy === column.key ? (sortOrder === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'SwitchVertical'"
								:class="sortBy === column.key ? 'access-sort-active' : 'access-sort-inactive'"
							/></button
						><span v-else>{{ column.label }}</span>
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
								><button type="button" class="access-user-copy" aria-label="Copy User ID" @click.stop="copy(user.user_id)">
									<UiIcon name="CopyOutlined" :size="12" /></button
							></UiTooltip>
						</div>
					</td>
					<td>{{ user.user_email || "-" }}</td>
					<td>{{ catalog.roles[user.user_role ?? ""]?.ui_label || "-" }}</td>
					<td>{{ user.user_alias || "-" }}</td>
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
					<td :colspan="columns.length" class="access-users-empty">No users found</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
