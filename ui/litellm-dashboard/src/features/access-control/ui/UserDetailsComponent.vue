<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import UserEditFieldsComponent from "./UserEditFieldsComponent.vue";
import InvitationDialogComponent from "./InvitationDialogComponent.vue";
import { createUserDetailStore } from "../stores/UserDetailStore";
import { rolesWithWriteAccess } from "../../identity/logic/UserRoleLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { budgetDurationOptions } from "../support/TeamFields";
import type { AccessCatalog } from "../support/AccessModels";
const props = defineProps<{ userId: string; catalog: AccessCatalog; role: string; edit?: boolean }>(),
	emit = defineEmits<{ close: []; changed: []; deleted: [] }>();
const store = createUserDetailStore(
		props.userId,
		() => {
			emit("deleted");
			emit("close");
		},
		() => emit("changed"),
	),
	{ state, data, teams } = store,
	money = useMoneyFormatter(),
	copied = ref(false);
state.editing = Boolean(props.edit);
state.tab = props.edit ? "details" : "overview";
const canManage = computed(() => rolesWithWriteAccess.includes(props.role)),
	proxyAdmin = computed(() => props.role === "Admin" || props.role === "proxy_admin"),
	availableTeams = computed(() => state.allTeams.filter((team) => !teams.value.some((current) => current.team_id === team.team_id)));
async function copy() {
	await navigator.clipboard.writeText(props.userId);
	copied.value = true;
	setTimeout(() => {
		copied.value = false;
	}, 2000);
}
function duration(value: string | null | undefined) {
	return budgetDurationOptions.find((option) => option.value === value)?.label || value || "Not set";
}
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiDrawer open class="access-user-drawer" :title="data?.user_email || 'User details'" @close="emit('close')"
		><template #title
			><div class="access-drawer-resource-title">
				<div class="access-drawer-resource-identity">
					<div>{{ data?.user_email || "User details" }}</div>
					<div v-if="data" class="access-drawer-resource-subtitle">{{ data.user_id }}</div>
				</div>
				<div v-if="canManage" class="access-drawer-resource-actions">
					<UiButton appearance="tremor" variant="primary" @click="state.editing = true">Edit</UiButton>
				</div>
			</div></template
		><AccessNoticeComponent :error="state.error" :message="state.message" />
		<p v-if="state.loading && !data">Loading user data...</p>
		<p v-else-if="!data">User not found</p>
		<div v-else class="access-user-detail">
			<header class="access-user-detail-header">
				<div>
					<UiButton appearance="tremor" variant="text" class="access-user-back" @click="emit('close')"
						><template #icon><AccessHeroIconComponent name="ArrowLeft" /></template>Back to Users</UiButton
					>
					<h2>{{ data.user_email || "User" }}</h2>
					<div class="access-user-detail-id">
						<span>{{ data.user_id }}</span
						><UiButton variant="text" size="small" :class="{ copied }" aria-label="Copy user ID" @click="copy"
							><UiLucideIcon :name="copied ? 'Check' : 'Copy'" :size="12"
						/></UiButton>
					</div>
				</div>
				<div v-if="canManage" class="access-user-detail-actions">
					<UiButton appearance="tremor" @click="store.invite"
						><template #icon><AccessHeroIconComponent name="Refresh" /></template>Reset Password</UiButton
					><UiButton appearance="tremor" class="access-user-delete" @click="state.deleteOpen = true"
						><template #icon><AccessHeroIconComponent name="Trash" /></template>Delete User</UiButton
					>
				</div>
			</header>
			<UiTabs
				v-model="state.tab"
				appearance="tremor"
				:items="[
					{ key: 'overview', label: 'Overview' },
					{ key: 'details', label: 'Details' },
				]"
			/>
			<div v-if="state.tab === 'overview'" class="access-overview-grid">
				<UiCard
					><p>Spend</p>
					<h3>{{ money(data.spend || 0, 4) }}</h3>
					<p>of {{ data.max_budget !== null ? money(data.max_budget, 4) : "Unlimited" }}</p></UiCard
				><UiCard
					><header class="access-card-inline-header">
						<p>Teams</p>
						<UiButton v-if="proxyAdmin" appearance="tremor" variant="link" size="small" @click="store.openTeam"
							><template #icon><UiLucideIcon name="PlusIcon" :size="12" /></template>Add Team</UiButton
						>
					</header>
					<table v-if="teams.length" class="access-budget-table">
						<thead>
							<tr>
								<th>Team Name</th>
								<th v-if="proxyAdmin">Actions</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="team in state.teamsExpanded ? teams : teams.slice(0, 20)" :key="team.team_id">
								<td :title="team.team_id">{{ team.team_alias || team.team_id }}</td>
								<td v-if="proxyAdmin" class="access-user-team-actions">
									<button
										type="button"
										class="access-user-team-remove"
										aria-label="Remove from Team"
										@click="state.removingTeam = team"
									>
										<UiLucideIcon name="Trash" :size="16" />
									</button>
								</td>
							</tr>
						</tbody>
					</table>
					<p v-else>No teams</p>
					<UiButton
						v-if="teams.length > 20"
						appearance="tremor"
						variant="link"
						size="small"
						@click="state.teamsExpanded = !state.teamsExpanded"
						>{{ state.teamsExpanded ? "Show Less" : "+" + (teams.length - 20) + " more" }}</UiButton
					></UiCard
				><UiCard
					><p>Personal Models</p>
					<div class="access-overview-values">
						<template v-if="data.models.length"
							><p v-for="model in data.models" :key="model">{{ model }}</p></template
						>
						<p v-else>All proxy models</p>
					</div></UiCard
				>
			</div>
			<UiCard v-else
				><header class="access-card-inline-header">
					<h3>User Settings</h3>
					<UiButton v-if="!state.editing && canManage" appearance="tremor" variant="primary" @click="state.editing = true"
						>Edit Settings</UiButton
					>
				</header>
				<UserEditFieldsComponent
					v-if="state.editing"
					:user="data"
					:catalog="catalog"
					:role="role"
					:pending="state.pending"
					@cancel="state.editing = false"
					@submit="store.save"
				/>
				<div v-else class="access-settings-summary">
					<div>
						<p>User ID</p>
						<button type="button" class="access-copy-text" @click="copy">
							<code>{{ data.user_id }}</code> {{ copied ? "✓" : "⧉" }}
						</button>
					</div>
					<div>
						<p>Email</p>
						{{ data.user_email || "Not Set" }}
					</div>
					<div>
						<p>User Alias</p>
						{{ data.user_alias || "Not Set" }}
					</div>
					<div>
						<p>Global Proxy Role</p>
						{{ data.user_role || "Not Set" }}
					</div>
					<div>
						<p>Created</p>
						{{ data.created_at ? new Date(data.created_at).toLocaleString() : "Unknown" }}
					</div>
					<div>
						<p>Last Updated</p>
						{{ data.updated_at ? new Date(data.updated_at).toLocaleString() : "Unknown" }}
					</div>
					<div>
						<p>Personal Models</p>
						<div class="access-tags">
							<span v-for="model in data.models" :key="model" class="access-model-label">{{ model }}</span
							><span v-if="!data.models.length">All proxy models</span>
						</div>
					</div>
					<div>
						<p>Max Budget</p>
						{{ data.max_budget != null ? money(data.max_budget, 4) : "Unlimited" }}
					</div>
					<div>
						<p>Budget Reset</p>
						{{ duration(data.budget_duration) }}
					</div>
					<div>
						<p>Metadata</p>
						<pre>{{ JSON.stringify(data.metadata || {}, null, 2) }}</pre>
					</div>
				</div></UiCard
			><InvitationDialogComponent v-model:open="state.inviteOpen" :invitation="state.invitation" reset /><AccessDeleteDialogComponent
				v-model:open="state.deleteOpen"
				title="Delete User?"
				message="Are you sure you want to delete this user? This action cannot be undone."
				information-title="User Information"
				:information="[
					{ label: 'Email', value: data.user_email },
					{ label: 'User ID', value: data.user_id, code: true },
					{ label: 'Global Proxy Role', value: catalog.roles[data.user_role ?? '']?.ui_label || data.user_role || '-' },
					{ label: 'Total Spend', value: money(data.spend, 2) },
				]"
				:pending="state.pending"
				@confirm="store.remove"
			/><UiDialog
				scroll-mode="overlay"
				v-model:open="state.teamOpen"
				title="Add User to Team"
				:width="600"
				ok-text="Add to Team"
				:confirm-loading="state.pending"
				@ok="store.addTeam"
				><AccessFieldComponent
					v-model="state.selectedTeamId"
					name="add-user-team"
					label="Team"
					type="select"
					:options="availableTeams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id }))"
					placeholder="Select a team" /><AccessFieldComponent
					v-model="state.selectedRole"
					name="add-user-team-role"
					label="Team Role"
					type="select"
					:options="[
						{ value: 'user', label: 'User' },
						{ value: 'admin', label: 'Admin' },
					]" /></UiDialog
			><AccessDeleteDialogComponent
				:open="Boolean(state.removingTeam)"
				title="Remove from Team"
				warning="Removing this user from the team will also delete any keys the user created for this team."
				message="Are you sure you want to remove this user from the team? This action cannot be undone."
				information-title="Team Membership"
				:information="[
					{ label: 'Team', value: state.removingTeam?.team_alias || state.removingTeam?.team_id },
					{ label: 'User ID', value: data.user_id, code: true },
					{ label: 'Email', value: data.user_email },
				]"
				:pending="state.pending"
				@update:open="!$event && (state.removingTeam = null)"
				@confirm="store.removeTeam"
			/></div
	></UiDrawer>
</template>
