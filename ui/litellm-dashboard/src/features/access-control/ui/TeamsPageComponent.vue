<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiPagination from "../../platform/ui/UiPagination.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import TeamFormDialogComponent from "./TeamFormDialogComponent.vue";
import TeamDetailsComponent from "./TeamDetailsComponent.vue";
import DefaultSettingsComponent from "./DefaultSettingsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { createTeamsStore } from "../stores/TeamsStore";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { canManageTeams } from "../logic/AccessPermissionLogic";
import { objectValue } from "../logic/ResourceDraftLogic";
import { emptyAccessCatalog, type AccessRecord, type AccessTeam } from "../support/AccessModels";
import { isProxyAdminRole } from "../../identity/logic/UserRoleLogic";
import "../styles/AccessStyles.css";
const auth = useAuthenticationStore(),
	application = useApplicationStore(),
	role = computed(() => auth.userRole.value),
	userId = computed(() => auth.state.session?.user_id ?? ""),
	premium = computed(() => auth.state.session?.premium_user ?? false),
	money = useMoneyFormatter(),
	catalog = shallowRef(emptyAccessCatalog());
const store = createTeamsStore(role.value, userId.value, () => application.initialize()),
	{ state, rows } = store;
const canCreate = computed(() => canManageTeams(role.value, userId.value, catalog.value.organizations));
const columns = [
	{ key: "team_id", label: "Team ID", width: 170, ellipsis: true },
	{ key: "team_alias", label: "Team Alias", sortable: true, ellipsis: true },
	{ key: "organization", label: "Organization", width: 160, ellipsis: true },
	{ key: "resources", label: "Resources", width: 240 },
	{ key: "spend", label: "Spend / Budget", width: 200, sortable: true },
	{ key: "created_at", label: "Created", width: 130, sortable: true, ellipsis: true },
	{ key: "actions", label: "Actions", width: 120, align: "right" as const },
];
const tabs = computed(() => [
	{ key: "your-teams", label: "Your Teams" },
	{ key: "available-teams", label: "Available Teams" },
	...(isProxyAdminRole(role.value) ? [{ key: "default-settings", label: "Default Team Settings" }] : []),
]);
function team(row: AccessRecord) {
	return row as AccessTeam;
}
function open(value: AccessTeam, edit = false) {
	state.detailId = value.team_id;
	state.editDetail = edit;
}
function org(value: AccessTeam) {
	return (
		catalog.value.organizations.find((org) => org.organization_id === value.organization_id)?.organization_alias ||
		value.organization_id ||
		"—"
	);
}
async function copy(value: AccessTeam) {
	await navigator.clipboard.writeText(value.team_id);
	state.message = "Team ID copied";
}
function tabChanged(key: string) {
	if (key === "available-teams") void store.available();
}
onMounted(() => {
	void store.refresh();
	void loadAccessCatalog()
		.then((value) => {
			catalog.value = value;
		})
		.catch((error) => {
			state.error = error instanceof Error ? error.message : "Failed to load team options";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="access-page access-teams-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><template v-if="!state.detailId"
			><header class="access-list-header">
				<div>
					<h2><UiIcon name="TeamOutlined" :size="30" />Teams</h2>
					<span class="access-muted">Manage teams, members, and their access to models and budgets</span>
				</div>
				<UiButton v-if="canCreate" variant="primary" @click="state.createOpen = true"
					><template #icon><UiIcon name="PlusOutlined" /></template>Create Team</UiButton
				>
			</header>
			<UiTabs v-model="state.tab" :items="tabs" @change="tabChanged" /><UiCard
				v-if="state.tab === 'your-teams'"
				appearance="antd"
				:padding="0"
				><div class="access-list-toolbar access-team-toolbar">
					<div class="access-team-search">
						<UiInput
							:model-value="state.query"
							placeholder="Search teams by name..."
							clearable
							@update:model-value="store.search"
							><template #prefix><UiLucideIcon name="Search" :size="14" /></template
							><template v-if="!state.query" #suffix
								><span style="display: block; width: 12px; height: 12px" /></template></UiInput
						><UiSelect
							:model-value="state.organizationId || undefined"
							@update:model-value="state.organizationId = String($event || '')"
							:options="catalog.organizations.map((org) => ({ value: org.organization_id, label: org.organization_alias }))"
							searchable
							clearable
							placeholder="All Organizations"
							@change="store.filter"
						/>
					</div>
					<div class="access-pagination">
						<span>{{ state.total }} teams</span
						><UiPagination
							v-model="state.page"
							v-model:page-size="state.pageSize"
							:total="state.total"
							show-size-changer
							:page-size-options="[10, 20, 50]"
							@change="store.refresh"
						/>
					</div>
				</div>
				<UiTable
					:columns="columns"
					:rows="rows"
					row-key="team_id"
					:loading="state.loading"
					:min-width="1000"
					row-clickable
					manual-sort
					@row-click="open(team($event))"
					@sort="store.sort($event.key, $event.order)"
					><template #header-team_alias><span class="access-team-header-label" title="Team Alias">Team Alias</span></template
					><template #cell-team_id="{ row }"
						><button type="button" class="access-id" :title="team(row).team_id" @click="open(team(row))">
							{{ team(row).team_id }}
						</button></template
					><template #cell-team_alias="{ value }"
						><span v-if="value">{{ value }}</span
						><em v-else class="access-muted">—</em></template
					><template #cell-organization="{ row }"
						><span :class="{ 'access-muted': !team(row).organization_id }">{{ org(team(row)) }}</span></template
					><template #cell-resources="{ row }"
						><div class="access-tags access-resource-tags">
							<UiTag color="purple"><UiLucideIcon name="Users" :size="14" />{{ team(row).members_with_roles.length }}</UiTag
							><UiTag color="blue"><UiLucideIcon name="LayersIcon" :size="14" />{{ team(row).models.length }}</UiTag
							><UiTag color="cyan"><UiLucideIcon name="KeyIcon" :size="14" />{{ team(row).keys.length }}</UiTag>
						</div></template
					><template #cell-spend="{ row }"
						><div class="access-team-spend">
							<span>
								{{ money(team(row).spend ?? 0, 4)
								}}<small class="access-muted">
									/ {{ team(row).max_budget == null ? "Unlimited" : money(team(row).max_budget, 4) }}</small
								></span
							>
							<div v-if="team(row).max_budget != null && Number(team(row).max_budget) > 0" class="access-team-progress">
								<div class="access-progress">
									<span
										:style="{
											width: Math.min((Number(team(row).spend ?? 0) / Number(team(row).max_budget)) * 100, 100) + '%',
										}"
									/>
								</div>
							</div></div></template
					><template #cell-created_at="{ value }"
						><span class="access-muted access-team-date">{{
							value
								? new Date(String(value)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
								: "—"
						}}</span></template
					><template #cell-actions="{ row }"
						><div class="access-tags">
							<AccessActionComponent name="Copy" label="Copy Team ID" @click="copy(team(row))" /><template
								v-if="role === 'Admin'"
								><AccessActionComponent
									name="SquarePen"
									label="Edit team"
									data-testid="edit-team-button"
									@click="open(team(row), true)" /><AccessActionComponent
									name="Trash2"
									label="Delete team"
									data-testid="delete-team-button"
									danger
									@click="state.deleting = team(row)"
							/></template></div></template
					><template #empty
						><div class="access-empty-teams">
							<UiLucideIcon name="Users" :size="40" />
							<p>No teams yet</p>
							<p class="access-muted">Create your first team to organize members and manage access to models.</p>
							<UiButton v-if="canCreate" variant="primary" @click="state.createOpen = true">Create Team</UiButton>
						</div></template
					></UiTable
				></UiCard
			><UiCard v-else-if="state.tab === 'available-teams'" class="access-available-teams"
				><table class="access-budget-table">
					<thead>
						<tr>
							<th>Team Name</th>
							<th>Description</th>
							<th>Members</th>
							<th>Models</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="value in state.available" :key="value.team_id">
							<td>{{ value.team_alias }}</td>
							<td>{{ value.description || "No description available" }}</td>
							<td>{{ value.members_with_roles.length }} members</td>
							<td>
								<UiTag v-for="model in value.models" :key="model" appearance="tremor" size="xs" color="blue">{{
									model.length > 30 ? model.slice(0, 30) + "..." : model
								}}</UiTag
								><UiTag v-if="!value.models.length" appearance="tremor" size="xs" color="red">All Proxy Models</UiTag>
							</td>
							<td>
								<UiButton appearance="tremor" size="small" :loading="state.pending" @click="store.join(value.team_id)"
									>Join Team</UiButton
								>
							</td>
						</tr>
						<tr v-if="!state.available.length">
							<td colspan="5">
								No available teams to join. See how to set available teams
								<a
									href="https://docs.litellm.ai/docs/proxy/self_serve#all-settings-for-self-serve--sso-flow"
									target="_blank"
									rel="noopener noreferrer"
									>here</a
								>.
							</td>
						</tr>
					</tbody>
				</table></UiCard
			><DefaultSettingsComponent v-else kind="team" :catalog="catalog" /></template
		><TeamDetailsComponent
			v-else
			:key="state.detailId"
			:team-id="state.detailId"
			:edit="state.editDetail"
			:catalog="catalog"
			:role="role"
			:user-id="userId"
			:premium="premium"
			:disable-team-admin-delete="Boolean(objectValue(application.state.settings).disable_team_admin_delete_team_user)"
			@close="state.detailId = ''"
			@changed="store.refresh"
		/><TeamFormDialogComponent
			v-model:open="state.createOpen"
			:catalog="catalog"
			:role="role"
			:user-id="userId"
			:premium="premium"
			:pending="state.pending"
			:organization-id="state.organizationId"
			@submit="store.create"
		/><AccessDeleteDialogComponent
			:open="Boolean(state.deleting)"
			title="Delete Team?"
			:warning="
				state.deleting?.keys.length
					? 'Warning: This team has ' +
						state.deleting.keys.length +
						' keys associated with it. Deleting the team will also delete all associated keys. This action is irreversible.'
					: undefined
			"
			message="Are you sure you want to delete this team and all its keys? This action cannot be undone."
			information-title="Team Information"
			:information="[
				{ label: 'Team ID', value: state.deleting?.team_id, code: true },
				{ label: 'Team Name', value: state.deleting?.team_alias },
				{ label: 'Keys', value: state.deleting?.keys.length },
				{ label: 'Members', value: state.deleting?.members_with_roles.length },
			]"
			:confirmation="state.deleting?.team_alias"
			:pending="state.pending"
			@update:open="!$event && (state.deleting = null)"
			@confirm="store.remove"
		/>
	</main>
</template>
