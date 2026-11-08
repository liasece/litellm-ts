<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import UsersTableComponent from "./UsersTableComponent.vue";
import UserDetailsComponent from "./UserDetailsComponent.vue";
import UserInviteDialogComponent from "./UserInviteDialogComponent.vue";
import InvitationDialogComponent from "./InvitationDialogComponent.vue";
import BulkUserEditDialogComponent from "./BulkUserEditDialogComponent.vue";
import CsvUsersDialogComponent from "./CsvUsersDialogComponent.vue";
import DefaultSettingsComponent from "./DefaultSettingsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { isAdminRole, isProxyAdminRole } from "../../identity/logic/UserRoleLogic";
import { createUsersStore } from "../stores/UsersStore";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { objectValue } from "../logic/ResourceDraftLogic";
import { emptyAccessCatalog, type AccessRecord, type AccessUser } from "../support/AccessModels";
import "../styles/AccessStyles.css";
import "../styles/UsersStyles.css";
const auth = useAuthenticationStore(),
	app = useApplicationStore(),
	catalog = shallowRef(emptyAccessCatalog()),
	role = computed(() => auth.userRole.value),
	proxyAdmin = computed(() => isProxyAdminRole(role.value)),
	money = useMoneyFormatter(),
	inviteReset = ref(0);
const organizationIds =
	role.value === "Org Admin"
		? app.state.organizations
				.filter((org) => {
					const members = objectValue(org).members;
					return (
						Array.isArray(members) &&
						members.some(
							(member) =>
								objectValue(member).user_id === auth.state.session?.user_id &&
								objectValue(member).user_role === "org_admin",
						)
					);
				})
				.map((org) => org.organization_id)
		: [];
const store = createUsersStore(organizationIds),
	{ state, rows } = store;
const selectedUsers = computed(() => rows.value.filter((user) => state.selected.includes(user.user_id))),
	sso = computed(() => Boolean(app.state.proxySettings.SSO_ENABLED));
function open(user: AccessUser, edit = false) {
	state.detailId = user.user_id;
	state.editDetail = edit;
}
function toggleSelection() {
	state.selection = !state.selection;
	state.selected = [];
}
function page(value: number) {
	state.page = value;
	void store.refresh();
}
async function invite(value: AccessRecord) {
	if (await store.invite(value, sso.value)) inviteReset.value++;
}
function filter(name: keyof typeof state.filters, value: unknown) {
	store.filter({ [name]: value == null ? "" : String(value) });
}
async function deleted() {
	await store.refresh();
}
onMounted(() => {
	void store.refresh();
	void loadAccessCatalog()
		.then((value) => {
			catalog.value = value;
		})
		.catch((reason) => {
			state.error = reason instanceof Error ? reason.message : "Failed to load user settings";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="access-users-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<header class="access-user-toolbar">
			<UiButton variant="primary" @click="state.inviteOpen = true">+ Invite User</UiButton
			><UiButton variant="primary" @click="state.bulkInviteOpen = true">+ Bulk Invite Users</UiButton
			><UiButton v-if="proxyAdmin" :variant="state.selection ? 'primary' : 'default'" @click="toggleSelection">{{
				state.selection ? "Cancel Selection" : "Select Users"
			}}</UiButton
			><UiButton
				v-if="proxyAdmin && state.selection"
				variant="primary"
				:disabled="!state.selected.length"
				@click="state.bulkEditOpen = true"
				>Bulk Edit ({{ state.selected.length }} selected)</UiButton
			>
		</header>
		<UiTabs
			v-if="proxyAdmin"
			v-model="state.tab"
			appearance="tremor"
			:items="[
				{ key: 'users', label: 'Users' },
				{ key: 'defaults', label: 'Default User Settings' },
			]"
		/><DefaultSettingsComponent v-if="proxyAdmin && state.tab === 'defaults'" kind="user" :catalog="catalog" />
		<section v-else class="access-user-list">
			<div class="access-user-list-controls">
				<div class="access-user-filters">
					<UiInput
						:model-value="state.filters.email"
						placeholder="Search by email..."
						class="access-user-search"
						@update:model-value="filter('email', $event)"
						><template #prefix><UiLucideIcon name="Search" :size="16" /></template></UiInput
					><UiButton @click="state.expanded = !state.expanded"><UiLucideIcon name="Filter" :size="16" />Filters</UiButton
					><UiButton @click="store.reset"><UiLucideIcon name="RotateCcw" :size="16" />Reset Filters</UiButton>
				</div>
				<div v-if="state.expanded" class="access-user-filters access-user-additional-filters">
					<UiInput
						:model-value="state.filters.user_id"
						placeholder="Filter by User ID"
						@update:model-value="filter('user_id', $event)"
						><template #prefix><UiLucideIcon name="User" :size="16" /></template></UiInput
					><UiInput
						:model-value="state.filters.sso_user_id"
						placeholder="Filter by SSO ID"
						@update:model-value="filter('sso_user_id', $event)"
						><template #prefix><UiLucideIcon name="CircleUserRound" :size="16" /></template></UiInput
					><UiSelect
						:model-value="state.filters.user_role || null"
						appearance="tremor"
						:options="Object.entries(catalog.roles).map(([value, role]) => ({ value, label: role.ui_label }))"
						placeholder="Select Role"
						@update:model-value="filter('user_role', $event)"
					/><UiSelect
						:model-value="state.filters.team || null"
						appearance="tremor"
						:options="catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id }))"
						placeholder="Select Team"
						@update:model-value="filter('team', $event)"
					/>
				</div>
				<div class="access-user-pagination">
					<span v-if="!state.loading"
						>Showing {{ rows.length ? (state.page - 1) * 25 + 1 : 0 }} - {{ Math.min(state.page * 25, state.total) }} of
						{{ state.total }} results</span
					>
					<div>
						<span>Page {{ state.page }} of {{ state.totalPages }}</span
						><button type="button" :disabled="state.loading || state.page <= 1" @click="page(state.page - 1)">Previous</button
						><button type="button" :disabled="state.loading || state.page >= state.totalPages" @click="page(state.page + 1)">
							Next
						</button>
					</div>
				</div>
			</div>
			<UsersTableComponent
				v-model:selected="state.selected"
				:rows="rows"
				:loading="state.loading"
				:catalog="catalog"
				:sort-by="state.filters.sort_by"
				:sort-order="state.filters.sort_order"
				:selection="proxyAdmin && state.selection"
				@open="open"
				@delete="state.deleting = $event"
				@reset="store.resetPassword"
				@sort="(key, order) => store.filter({ sort_by: key, sort_order: order })"
			/>
		</section>
		<UserDetailsComponent
			v-if="state.detailId"
			:key="state.detailId"
			:user-id="state.detailId"
			:catalog="catalog"
			:role="role"
			:edit="state.editDetail"
			@close="state.detailId = ''"
			@changed="store.refresh"
			@deleted="deleted"
		/><UserInviteDialogComponent
			v-model:open="state.inviteOpen"
			:catalog="catalog"
			:pending="state.pending"
			:reset-key="inviteReset"
			@submit="invite"
		/><CsvUsersDialogComponent
			v-model:open="state.bulkInviteOpen"
			:catalog="catalog"
			:sso="sso"
			@created="store.refresh"
		/><BulkUserEditDialogComponent
			v-model:open="state.bulkEditOpen"
			:users="selectedUsers"
			:catalog="catalog"
			:role="role"
			:pending="state.pending"
			:allow-all="isAdminRole(role)"
			@submit="store.bulk"
		/><InvitationDialogComponent
			v-model:open="state.invitationOpen"
			:invitation="state.invitation"
			:reset="state.resetInvitation"
		/><AccessDeleteDialogComponent
			:open="Boolean(state.deleting)"
			title="Delete User?"
			message="Are you sure you want to delete this user? This action cannot be undone."
			information-title="User Information"
			:information="[
				{ label: 'Email', value: state.deleting?.user_email },
				{ label: 'User ID', value: state.deleting?.user_id, code: true },
				{
					label: 'Global Proxy Role',
					value: catalog.roles[state.deleting?.user_role ?? '']?.ui_label || state.deleting?.user_role || '-',
				},
				{ label: 'Total Spend', value: money(state.deleting?.spend, 2) },
			]"
			:pending="state.pending"
			@update:open="!$event && (state.deleting = null)"
			@confirm="store.remove"
		/>
	</main>
</template>
