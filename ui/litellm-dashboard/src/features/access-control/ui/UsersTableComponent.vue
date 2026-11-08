<script setup lang="ts">
import { computed } from "vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessCatalog, AccessUser } from "../support/AccessModels";
const props = defineProps<{
	rows: AccessUser[];
	loading: boolean;
	catalog: AccessCatalog;
	sortBy: string;
	sortOrder: "asc" | "desc";
	selection: boolean;
	selected: string[];
}>();
const emit = defineEmits<{
	open: [user: AccessUser, edit?: boolean];
	delete: [user: AccessUser];
	reset: [id: string];
	sort: [key: string, order: "asc" | "desc"];
	"update:selected": [values: string[]];
}>();
const money = useMoneyFormatter();
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
const allSelected = computed(() => props.rows.length > 0 && props.selected.length === props.rows.length),
	someSelected = computed(() => props.selected.length > 0 && props.selected.length < props.rows.length);
function select(id: string, checked: boolean) {
	emit("update:selected", checked ? [...props.selected, id] : props.selected.filter((value) => value !== id));
}
function sort(key: string) {
	const first = typeof props.rows[0]?.[key] === "string" ? "asc" : "desc";
	if (props.sortBy !== key) {
		emit("sort", key, first);
		return;
	}
	if (props.sortOrder === first) emit("sort", key, first === "asc" ? "desc" : "asc");
	else emit("sort", "created_at", "desc");
}
async function copy(id: string) {
	await navigator.clipboard.writeText(id);
}
</script>
<template>
	<div class="access-users-table-wrap">
		<table class="access-users-table">
			<thead>
				<tr>
					<th v-if="selection">
						<UiCheckbox
							:model-value="allSelected"
							:indeterminate="someSelected"
							label="Select all users"
							@update:model-value="emit('update:selected', $event ? rows.map((user) => user.user_id) : [])"
						/>
					</th>
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
					<td :colspan="columns.length + (selection ? 1 : 0)" class="access-users-empty">🚅 Loading users...</td>
				</tr>
				<tr v-for="user in loading ? [] : rows" :key="user.user_id">
					<td v-if="selection">
						<UiCheckbox
							:model-value="selected.includes(user.user_id)"
							:label="'Select user ' + user.user_id"
							@update:model-value="select(user.user_id, $event)"
						/>
					</td>
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
								<AccessHeroIconComponent name="Trash" :size="20" /></button
							><button
								type="button"
								class="access-users-row-action"
								title="Reset Password"
								aria-label="Reset Password"
								@click="emit('reset', user.user_id)"
							>
								<AccessHeroIconComponent name="Refresh" :size="20" />
							</button>
						</div>
					</td>
				</tr>
				<tr v-if="!loading && !rows.length">
					<td :colspan="columns.length + (selection ? 1 : 0)" class="access-users-empty">No users found</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
