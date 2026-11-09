<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import UsersTableComponent from "./UsersTableComponent.vue";
import UserDetailsComponent from "./UserDetailsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { createUsersStore } from "../stores/UsersStore";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { objectValue } from "../logic/ResourceDraftLogic";
import { emptyAccessCatalog, type AccessUser } from "../support/AccessModels";
import "../styles/AccessStyles.css";
import "../styles/UsersStyles.css";
const auth = useAuthenticationStore(),
	app = useApplicationStore(),
	catalog = shallowRef(emptyAccessCatalog()),
	role = computed(() => auth.userRole.value),
	money = useMoneyFormatter();
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
function open(user: AccessUser, edit = false) {
	state.detailId = user.user_id;
	state.editDetail = edit;
}
function page(value: number) {
	state.page = value;
	void store.refresh();
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
			<div>
				<h2>Users</h2>
				<span class="access-muted">Manage users and their organization and team access</span>
			</div>
		</header>
		<section class="access-user-list">
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
				:rows="rows"
				:loading="state.loading"
				:catalog="catalog"
				:sort-by="state.filters.sort_by"
				:sort-order="state.filters.sort_order"
				@open="open"
				@delete="state.deleting = $event"
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
		/>
		<AccessDeleteDialogComponent
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
