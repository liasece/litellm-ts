<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import "../styles/AccessStyles.css";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import TeamOverviewComponent from "./TeamOverviewComponent.vue";
import TeamSettingsComponent from "./TeamSettingsComponent.vue";
import MembersTableComponent from "./MembersTableComponent.vue";
import MemberDialogComponent from "./MemberDialogComponent.vue";
import TeamKeysComponent from "./TeamKeysComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import { createTeamDetailStore } from "../stores/TeamDetailStore";
import { canEditTeam, teamTabs } from "../logic/AccessPermissionLogic";
import type { AccessCatalog } from "../support/AccessModels";
const props = defineProps<{
	teamId: string;
	edit?: boolean;
	catalog: AccessCatalog;
	role: string;
	userId: string;
	premium?: boolean;
	disableTeamAdminDelete?: boolean;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const store = createTeamDetailStore(props.teamId, () => emit("changed")),
	{ state, data } = store,
	tab = ref(props.edit ? "settings" : "overview"),
	copied = ref(false);
const editable = computed(() =>
	Boolean(data.value && canEditTeam(data.value.team_info, props.role, props.userId, props.catalog.organizations)),
);
const mayDeleteMember = computed(
	() =>
		props.role === "Admin" ||
		!data.value?.team_info.members_with_roles.some((member) => member.user_id === props.userId && member.role === "admin") ||
		!props.disableTeamAdminDelete,
);
function add() {
	state.memberOpen = true;
}
async function copy() {
	try {
		await copyText(props.teamId);
	} catch {
		return;
	}
	copied.value = true;
	setTimeout(() => {
		copied.value = false;
	}, 2000);
}
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiDrawer open :title="data?.team_info.team_alias || 'Team'" @close="emit('close')"
		><template #title
			><div class="access-drawer-resource-title">
				<div class="access-drawer-resource-identity">
					<div>{{ data?.team_info.team_alias || "Team" }}</div>
					<div v-if="data" class="access-drawer-resource-subtitle">{{ data.team_info.team_id }}</div>
				</div>
				<div v-if="editable" class="access-drawer-resource-actions">
					<UiButton variant="primary" @click="state.editing = true">Edit</UiButton>
				</div>
			</div></template
		><AccessNoticeComponent :error="state.error" :message="state.message" />
		<p v-if="state.loading && !data">Loading...</p>
		<p v-else-if="!data">Team not found</p>
		<div v-else class="access-team-detail">
			<header class="access-team-detail-header">
				<UiButton variant="text" class="access-team-back" @click="emit('close')"
					><template #icon><AccessHeroIconComponent name="ArrowLeft" :size="16" /></template>Back to Teams</UiButton
				>
				<h2>{{ data.team_info.team_alias || "Team" }}</h2>
				<div class="access-user-detail-id">
					<span>{{ data.team_info.team_id }}</span
					><UiButton variant="text" size="small" :class="{ copied }" aria-label="Copy team ID" @click="copy"
						><UiLucideIcon :name="copied ? 'Check' : 'Copy'" :size="12"
					/></UiButton>
				</div>
			</header>
			<UiTabs v-model="tab" :items="teamTabs(editable)" /><TeamOverviewComponent
				v-if="tab === 'overview'"
				:data="data"
				:catalog="catalog"
			/><TeamKeysComponent v-else-if="tab === 'virtual-keys'" :team="data.team_info" /><MembersTableComponent
				v-else-if="tab === 'members' && editable"
				:members="data.team_info.members_with_roles"
				:memberships="data.team_memberships"
				:can-edit="editable"
				:can-delete="mayDeleteMember"
				@add="add"
				@delete="state.deletingMember = $event"
			/><TeamSettingsComponent
				v-else-if="tab === 'settings' && editable"
				:team="data.team_info"
				:catalog="catalog"
				:editing="state.editing"
				:can-edit="editable"
				:premium="premium"
				:pending="state.pending"
				@edit="state.editing = true"
				@cancel="state.editing = false"
				@submit="store.save"
			/>
		</div>
		<MemberDialogComponent
			v-model:open="state.memberOpen"
			:pending="state.pending"
			@submit="store.member" /><AccessDeleteDialogComponent
			:open="Boolean(state.deletingMember)"
			title="Delete Team Member"
			warning="Removing team members will also delete any keys created by or created for this member."
			message="Are you sure you want to remove this member from the team? This action cannot be undone."
			information-title="Team Member Information"
			:information="[
				{ label: 'User ID', value: state.deletingMember?.user_id, code: true },
				{ label: 'Email', value: state.deletingMember?.user_email },
				{ label: 'Role', value: state.deletingMember?.role },
			]"
			:pending="state.pending"
			@update:open="!$event && (state.deletingMember = null)"
			@confirm="store.deleteMember"
	/></UiDrawer>
</template>
