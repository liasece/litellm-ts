<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import UsersTableComponent from "./UsersTableComponent.vue";
import UserDetailsComponent from "./UserDetailsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { createUsersStore, emptyUserFilters } from "../stores/UsersStore";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { objectValue } from "../logic/ResourceDraftLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
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
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	user_id: [{ key: "user_id", label: "User ID", control: { kind: "text", placeholder: "Filter by user ID" } }],
	user_email: [{ key: "email", label: "Email", control: { kind: "text", placeholder: "Filter by email" } }],
	user_role: [
		{
			key: "user_role",
			label: "Global Proxy Role",
			control: {
				kind: "select",
				options: Object.entries(catalog.value.roles).map(([value, role]) => ({ value, label: role.ui_label })),
			},
		},
	],
	sso_user_id: [{ key: "sso_user_id", label: "SSO ID", control: { kind: "text", placeholder: "Filter by SSO ID" } }],
	teams: [
		{
			key: "team",
			label: "Team",
			control: {
				kind: "select",
				searchable: true,
				options: catalog.value.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id })),
			},
		},
	],
}));
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const filters = state.filters;
	const entries: UiTableActiveFilter[] = [];
	if (filters.email) entries.push({ key: "email", label: "Email", value: filters.email, text: filters.email, match: "fuzzy" });
	if (filters.user_id) entries.push({ key: "user_id", label: "User ID", value: filters.user_id, text: filters.user_id, match: "exact" });
	if (filters.user_role)
		entries.push({
			key: "user_role",
			label: "Global Proxy Role",
			value: filters.user_role,
			text: catalog.value.roles[filters.user_role]?.ui_label || filters.user_role,
			match: "exact",
		});
	if (filters.sso_user_id)
		entries.push({ key: "sso_user_id", label: "SSO ID", value: filters.sso_user_id, text: filters.sso_user_id, match: "exact" });
	if (filters.team) {
		const team = catalog.value.teams.find((item) => item.team_id === filters.team);
		entries.push({ key: "team", label: "Team", value: filters.team, text: team?.team_alias || filters.team, match: "exact" });
	}
	return entries;
});
function applyUserFilters(entries: readonly UiTableActiveFilter[]): void {
	const patch: Partial<Record<"email" | "user_id" | "user_role" | "sso_user_id" | "team", string>> = {};
	for (const entry of entries) patch[entry.key as keyof typeof patch] = entry.value;
	store.filter(patch);
}
function removeUserFilter(key: string): void {
	store.filter({ [key]: "" } as Partial<ReturnType<typeof emptyUserFilters>>);
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
				:filter-fields="filterFields"
				:active-filters="activeFilters"
				@open="open"
				@delete="state.deleting = $event"
				@sort="(key, order) => store.filter({ sort_by: key, sort_order: order })"
				@filter-change="applyUserFilters"
				@remove-filter="removeUserFilter"
				@clear-filters="store.reset"
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
