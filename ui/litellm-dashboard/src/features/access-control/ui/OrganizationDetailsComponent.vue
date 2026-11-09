<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import MembersTableComponent from "./MembersTableComponent.vue";
import MemberDialogComponent from "./MemberDialogComponent.vue";
import OrganizationFieldsComponent from "./OrganizationFieldsComponent.vue";
import PermissionSummaryComponent from "./PermissionSummaryComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { createOrganizationDetailStore } from "../stores/OrganizationDetailStore";
import { organizationDraft } from "../logic/ResourceDraftLogic";
import type { AccessCatalog } from "../support/AccessModels";
const props = defineProps<{ organizationId: string; catalog: AccessCatalog; edit?: boolean; canEdit: boolean }>(),
	emit = defineEmits<{ back: []; changed: [] }>();
const store = createOrganizationDetailStore(props.organizationId, () => emit("changed")),
	{ state, data } = store,
	tab = ref(props.edit ? "settings" : "overview"),
	draft = ref(organizationDraft()),
	error = ref(""),
	money = useMoneyFormatter();
watch(
	() => [state.editing, data.value],
	() => {
		draft.value = organizationDraft(data.value ?? undefined);
		error.value = "";
	},
);
function addMember() {
	state.memberOpen = true;
}
function save() {
	if (!draft.value.organization_alias) {
		error.value = "Please input an organization name";
		return;
	}
	void store.save(draft.value);
}
async function copyId() {
	if (data.value) await navigator.clipboard.writeText(data.value.organization_id).catch(() => undefined);
}
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<p v-if="state.loading && !data">Loading...</p>
	<p v-else-if="!data">Organization not found</p>
	<div v-else class="access-organization-detail">
		<AccessNoticeComponent :error="state.error || error" :message="state.message" />
		<header class="access-org-detail-header">
			<button type="button" class="access-org-back" @click="emit('back')">
				<AccessHeroIconComponent name="ArrowLeft" :size="16" /><span>Back to Organizations</span>
			</button>
			<h2 class="access-org-title">{{ data.organization_alias }}</h2>
			<p class="access-org-id">
				<span class="access-org-id-value">{{ data.organization_id }}</span
				><button type="button" class="access-org-copy" aria-label="Copy organization ID" @click="copyId">
					<UiIcon name="CopyOutlined" :size="14" />
				</button>
			</p>
		</header>
		<UiTabs
			v-model="tab"
			:items="[
				{ key: 'overview', label: 'Overview' },
				{ key: 'members', label: 'Members' },
				{ key: 'settings', label: 'Settings' },
			]"
		/>
		<div v-if="tab === 'overview'" class="access-overview-grid">
			<UiCard
				><p>Organization Details</p>
				<div class="access-overview-values">
					<p>Created: {{ data.created_at ? new Date(data.created_at).toLocaleDateString() : "" }}</p>
					<p>Updated: {{ data.updated_at ? new Date(String(data.updated_at)).toLocaleDateString() : "" }}</p>
					<p>Created By: {{ data.created_by }}</p>
				</div></UiCard
			><UiCard
				><p>Budget Status</p>
				<div class="access-overview-values">
					<h3>{{ money(data.spend, 4) }}</h3>
					<p>
						of
						{{ data.litellm_budget_table.max_budget == null ? "Unlimited" : money(data.litellm_budget_table.max_budget, 4) }}
					</p>
					<p v-if="data.litellm_budget_table.budget_duration" class="access-muted">
						Reset: {{ data.litellm_budget_table.budget_duration }}
					</p>
				</div></UiCard
			><UiCard
				><p>Rate Limits</p>
				<div class="access-overview-values">
					<p>TPM: {{ data.litellm_budget_table.tpm_limit || "Unlimited" }}</p>
					<p>RPM: {{ data.litellm_budget_table.rpm_limit || "Unlimited" }}</p>
					<p v-if="data.litellm_budget_table.max_parallel_requests">
						Max Parallel Requests: {{ data.litellm_budget_table.max_parallel_requests }}
					</p>
				</div></UiCard
			><UiCard
				><p>Models</p>
				<div class="access-tags">
					<UiTag v-for="model in data.models" :key="model" appearance="tremor" color="red">{{ model }}</UiTag
					><UiTag v-if="!data.models.length" appearance="tremor" color="red">All proxy models</UiTag>
				</div></UiCard
			><UiCard
				><p>Teams</p>
				<div class="access-tags">
					<UiTag v-for="team in data.teams" :key="team.team_id" appearance="tremor" color="red">{{
						catalog.teams.find((value) => value.team_id === team.team_id)?.team_alias || team.team_id
					}}</UiTag>
				</div></UiCard
			><PermissionSummaryComponent :permission="data.object_permission" />
		</div>
		<MembersTableComponent
			v-else-if="tab === 'members'"
			:members="data.members"
			:can-edit="canEdit"
			organization
			@add="addMember"
			@delete="store.deleteMember"
		/><UiCard v-else class="access-team-settings"
			><header>
				<h3>Organization Settings</h3>
				<UiButton v-if="canEdit && !state.editing" appearance="tremor" variant="primary" @click="state.editing = true"
					>Edit Settings</UiButton
				>
			</header>
			<form v-if="state.editing" @submit.prevent="save">
				<OrganizationFieldsComponent v-model="draft" :catalog="catalog" editing />
				<footer class="access-sticky-footer">
					<UiButton appearance="tremor" :disabled="state.pending" @click="state.editing = false">Cancel</UiButton
					><UiButton appearance="tremor" variant="primary" type="submit" :loading="state.pending">Save Changes</UiButton>
				</footer>
			</form>
			<div v-else class="access-settings-summary">
				<div>
					<p>Organization Name</p>
					{{ data.organization_alias }}
				</div>
				<div>
					<p>Organization ID</p>
					<code>{{ data.organization_id }}</code>
				</div>
				<div>
					<p>Created At</p>
					{{ data.created_at ? new Date(data.created_at).toLocaleString() : "" }}
				</div>
				<div>
					<p>Models</p>
					<div class="access-tags">
						<span v-for="model in data.models" :key="model">{{ model }}</span>
					</div>
				</div>
				<div>
					<p>Rate Limits</p>
					<div>TPM: {{ data.litellm_budget_table.tpm_limit || "Unlimited" }}</div>
					<div>RPM: {{ data.litellm_budget_table.rpm_limit || "Unlimited" }}</div>
				</div>
				<div>
					<p>Budget</p>
					<div>
						Max:
						{{ data.litellm_budget_table.max_budget !== null ? money(data.litellm_budget_table.max_budget, 4) : "No Limit" }}
					</div>
					<div>Reset: {{ data.litellm_budget_table.budget_duration || "Never" }}</div>
				</div>
				<PermissionSummaryComponent :permission="data.object_permission" inline /></div></UiCard
		><MemberDialogComponent v-model:open="state.memberOpen" :pending="state.pending" organization @submit="store.member" />
	</div>
</template>
