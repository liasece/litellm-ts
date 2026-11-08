<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import OrganizationFormDialogComponent from "./OrganizationFormDialogComponent.vue";
import OrganizationDetailsComponent from "./OrganizationDetailsComponent.vue";
import OrganizationModelsComponent from "./OrganizationModelsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { createResourceStore } from "../stores/ResourceStore";
import { accessApi } from "../api/AccessApi";
import { buildOrganizationPayload } from "../logic/ResourceDraftLogic";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { emptyAccessCatalog, type AccessRecord, type AccessOrganization } from "../support/AccessModels";
import "../styles/AccessStyles.css";
const auth = useAuthenticationStore(),
	app = useApplicationStore(),
	money = useMoneyFormatter(),
	orgId = ref(""),
	alias = ref(""),
	expanded = ref(false),
	createOpen = ref(false),
	deleting = ref<AccessOrganization | null>(null),
	detailId = ref(""),
	edit = ref(false),
	catalog = shallowRef(emptyAccessCatalog()),
	tab = ref("organizations");
const store = createResourceStore((signal) => accessApi.organizations({ org_id: orgId.value, org_alias: alias.value }, signal)),
	{ state, rows } = store;
const sorted = computed(() =>
	[...rows.value].sort((a, b) => new Date(b.created_at ?? "").getTime() - new Date(a.created_at ?? "").getTime()),
);
const columns = [
	{ key: "organization_id", label: "Organization ID" },
	{ key: "organization_alias", label: "Organization Name" },
	{ key: "created_at", label: "Created" },
	{ key: "spend", label: "Spend" },
	{ key: "budget", label: "Budget" },
	{ key: "models", label: "Models" },
	{ key: "limits", label: "TPM / RPM Limits" },
	{ key: "info", label: "Info" },
	{ key: "actions", label: "Actions" },
];
function organization(row: AccessRecord) {
	return row as AccessOrganization;
}
function open(org: AccessOrganization, editing = false) {
	detailId.value = org.organization_id;
	edit.value = editing;
}
function reset() {
	orgId.value = "";
	alias.value = "";
	void store.refresh();
}
async function changed() {
	await store.refresh();
	await app.initialize();
}
async function create(draft: AccessRecord) {
	try {
		const payload = buildOrganizationPayload(draft);
		if (
			await store.run(
				() => accessApi.createOrganization(payload),
				"Organization created successfully",
				() => app.initialize(),
			)
		)
			createOpen.value = false;
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "Failed to create organization";
	}
}
async function remove() {
	const org = deleting.value;
	if (
		org &&
		(await store.run(
			() => accessApi.deleteOrganization(org.organization_id),
			"Organization deleted successfully",
			() => app.initialize(),
		))
	)
		deleting.value = null;
}
onMounted(() => {
	if (auth.state.session?.premium_user) {
		void store.refresh();
		void loadAccessCatalog()
			.then((value) => {
				catalog.value = value;
			})
			.catch((reason) => {
				state.error = reason instanceof Error ? reason.message : "Failed to load organization options";
			});
	}
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<p v-if="!auth.state.session?.premium_user" class="access-enterprise-note">
		This is a LiteLLM Enterprise feature, and requires a valid key to use. Get a trial key
		<a href="https://www.litellm.ai/#pricing" target="_blank" rel="noopener noreferrer">here</a>.
	</p>
	<main v-else class="access-organizations-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><OrganizationDetailsComponent
			v-if="detailId"
			:key="detailId"
			:organization-id="detailId"
			:catalog="catalog"
			:edit="edit"
			can-edit
			@back="detailId = ''"
			@changed="changed"
		/><template v-else
			><UiButton
				v-if="auth.userRole.value === 'Admin' || auth.userRole.value === 'Org Admin'"
				appearance="tremor"
				variant="primary"
				@click="createOpen = true"
				>+ Create New Organization</UiButton
			><UiTabs v-model="tab" appearance="tremor" :items="[{ key: 'organizations', label: 'Your Organizations' }]" />
			<p>Click on “Organization ID” to view organization details.</p>
			<UiCard class="access-organization-list"
				><div class="access-organization-filters">
					<div class="access-tags">
						<UiInput v-model="alias" placeholder="Search by Organization Name" @update:model-value="store.refresh" /><UiButton
							@click="expanded = !expanded"
							>Filters</UiButton
						><UiButton @click="reset">Reset Filters</UiButton
						><UiButton aria-label="Refresh organizations" @click="store.refresh">↻</UiButton>
					</div>
					<UiInput v-if="expanded" v-model="orgId" placeholder="Search by Organization ID" @update:model-value="store.refresh" />
				</div>
				<UiTable :rows="sorted" :columns="columns" row-key="organization_id" appearance="tremor"
					><template #cell-organization_id="{ row }"
						><button
							class="access-id"
							type="button"
							:title="organization(row).organization_id"
							@click="open(organization(row))"
						>
							{{ organization(row).organization_id.slice(0, 7) }}...
						</button></template
					><template #cell-created_at="{ value }">{{ value ? new Date(String(value)).toLocaleDateString() : "N/A" }}</template
					><template #cell-spend="{ row }">{{ money(organization(row).spend, 4) }}</template
					><template #cell-budget="{ row }">{{
						organization(row).litellm_budget_table.max_budget == null
							? "No limit"
							: money(organization(row).litellm_budget_table.max_budget)
					}}</template
					><template #cell-models="{ row }"><OrganizationModelsComponent :models="organization(row).models" /></template
					><template #cell-limits="{ row }"
						><span
							>TPM: {{ organization(row).litellm_budget_table.tpm_limit || "Unlimited" }}<br />RPM:
							{{ organization(row).litellm_budget_table.rpm_limit || "Unlimited" }}</span
						></template
					><template #cell-info="{ row }">{{ organization(row).members.length }} Members</template
					><template #cell-actions="{ row }"
						><div v-if="auth.userRole.value === 'Admin'" class="access-tags">
							<AccessActionComponent
								name="SquarePen"
								label="Edit organization"
								@click="open(organization(row), true)"
							/><AccessActionComponent
								name="Trash2"
								label="Delete organization"
								danger
								@click="deleting = organization(row)"
							/></div></template></UiTable></UiCard></template
		><OrganizationFormDialogComponent
			v-model:open="createOpen"
			:catalog="catalog"
			:pending="state.pending"
			@submit="create"
		/><AccessDeleteDialogComponent
			:open="Boolean(deleting)"
			title="Delete Organization?"
			message="Are you sure you want to delete this organization? This action cannot be undone."
			information-title="Organization Information"
			:information="[{ label: 'Organization ID', value: deleting?.organization_id, code: true }]"
			:pending="state.pending"
			@update:open="!$event && (deleting = null)"
			@confirm="remove"
		/>
	</main>
</template>
