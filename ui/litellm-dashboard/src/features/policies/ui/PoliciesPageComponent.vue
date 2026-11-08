<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { createPoliciesStore } from "../stores/PoliciesStore";
import { createPolicyTemplateStore } from "../stores/PolicyTemplateStore";
import PolicyAboutAlertComponent from "./common/PolicyAboutAlertComponent.vue";
import PolicyTemplatesComponent from "./templates/PolicyTemplatesComponent.vue";
import PolicyGuardrailSelectionDialogComponent from "./templates/PolicyGuardrailSelectionDialogComponent.vue";
import PolicyParametersDialogComponent from "./templates/PolicyParametersDialogComponent.vue";
import PolicyTableComponent from "./list/PolicyTableComponent.vue";
import PolicyInfoComponent from "./list/PolicyInfoComponent.vue";
import PolicyFormDialogComponent from "./forms/PolicyFormDialogComponent.vue";
import PolicyDeleteDialogsComponent from "./forms/PolicyDeleteDialogsComponent.vue";
import PolicyAttachmentTableComponent from "./attachments/PolicyAttachmentTableComponent.vue";
import PolicyAttachmentDialogComponent from "./attachments/PolicyAttachmentDialogComponent.vue";
import PolicySimulatorComponent from "./simulator/PolicySimulatorComponent.vue";
import PolicyFlowPageComponent from "./flow/PolicyFlowPageComponent.vue";
import PolicyAiSuggestionDialogComponent from "./ai/PolicyAiSuggestionDialogComponent.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import "./styles/PoliciesStyles.css";
import "./styles/PolicyTablesStyles.css";
import "./styles/PolicyFormsStyles.css";
import "./styles/PolicyTemplateDialogsStyles.css";
import "./styles/PolicyFlowStyles.css";
import "./styles/PolicyFlowPanelsStyles.css";
import "./styles/PolicyAiStyles.css";
import "./styles/PolicyAiTestStyles.css";
const auth = useAuthenticationStore(),
	store = createPoliciesStore(),
	state = store.state,
	templates = createPolicyTemplateStore(store),
	templateState = templates.state,
	isAdmin = computed(() => isAdminRole(auth.userRole.value)),
	enterpriseNotice = ref(true);
const tabs = [
	{ key: "templates", label: "Templates" },
	{ key: "policies", label: "Policies" },
	{ key: "attachments", label: "Attachments" },
	{ key: "simulator", label: "Policy Simulator" },
];
onMounted(() => void store.load());
onBeforeUnmount(() => {
	templates.dispose();
	store.dispose();
});
function flow() {
	state.addOpen = false;
	state.flowOpen = true;
}
function back() {
	state.flowOpen = false;
	state.editing = null;
}
</script>
<template>
	<div class="policies-page">
		<UiTabs v-model="state.tab" :items="tabs" appearance="tremor" />
		<div class="policy-tab-panels">
			<section v-show="state.tab === 'templates'">
				<PolicyAboutAlertComponent /><PolicyTemplatesComponent
					:templates="state.templates"
					:loading="state.templatesLoading"
					@use="templates.use"
					@ai="state.aiOpen = true"
				/>
			</section>
			<section v-show="state.tab === 'policies'">
				<PolicyAboutAlertComponent />
				<div class="policy-toolbar">
					<UiButton variant="primary" appearance="tremor" :disabled="!auth.isAuthorized.value" @click="store.add"
						>+ Add New Policy</UiButton
					>
				</div>
				<PolicyInfoComponent
					v-if="state.selectedId"
					:policy-id="state.selectedId"
					:is-admin="isAdmin"
					@close="state.selectedId = null"
					@edit="store.edit"
				/><PolicyTableComponent
					v-else
					:policies="state.policies"
					:loading="state.loading"
					:is-admin="isAdmin"
					@view="state.selectedId = $event"
					@edit="store.edit"
					@delete="state.deletePolicy = $event"
				/>
			</section>
			<section v-show="state.tab === 'attachments'">
				<PolicyAboutAlertComponent attachments /><UiAlert
					v-if="enterpriseNotice"
					type="warning"
					title="Enterprise Feature Notice"
					closable
					class="policy-mb24"
					@close="enterpriseNotice = false"
					>Parts of policy attachments will be on LiteLLM Enterprise in subsequent releases.</UiAlert
				>
				<div class="policy-toolbar">
					<UiButton
						variant="primary"
						appearance="tremor"
						:disabled="!auth.isAuthorized.value || !state.policies.length"
						@click="state.attachmentOpen = true"
						>+ Add New Attachment</UiButton
					>
				</div>
				<PolicyAttachmentTableComponent
					:attachments="state.attachments"
					:loading="state.attachmentsLoading"
					:is-admin="isAdmin"
					@delete="state.deleteAttachment = $event"
				/>
			</section>
			<section v-show="state.tab === 'simulator'"><PolicySimulatorComponent /></section>
		</div>
		<PolicyFormDialogComponent
			:open="state.addOpen"
			:editing="state.editing"
			:policies="state.policies"
			:guardrails="state.guardrails"
			@close="store.closeForm"
			@saved="store.saved"
			@flow="flow"
		/>
		<PolicyAttachmentDialogComponent
			:open="state.attachmentOpen"
			:policies="state.policies"
			@close="state.attachmentOpen = false"
			@saved="store.attachments"
		/>
		<PolicyDeleteDialogsComponent
			:policy="state.deletePolicy"
			:attachment-id="state.deleteAttachment"
			:loading="state.deleting"
			@cancel-policy="state.deletePolicy = null"
			@delete-policy="store.confirmDeletePolicy"
			@cancel-attachment="state.deleteAttachment = null"
			@delete-attachment="store.confirmDeleteAttachment"
		/>
		<PolicyGuardrailSelectionDialogComponent
			:open="templateState.selectionOpen"
			:template="templateState.selected"
			:existing="templateState.existingNames"
			:loading="templateState.creating"
			:progress="templateState.progress"
			@close="templates.cancelSelection"
			@confirm="templates.confirm"
		/>
		<PolicyParametersDialogComponent
			:open="templateState.parameterOpen"
			:template="templateState.pending"
			:loading="templateState.enriching"
			@close="templates.cancelParameters"
			@confirm="templates.parameters"
		/>
		<PolicyAiSuggestionDialogComponent
			:open="state.aiOpen"
			:templates="state.templates"
			@close="state.aiOpen = false"
			@select="templates.select"
		/>
		<PolicyFlowPageComponent
			v-if="state.flowOpen"
			:editing="state.editing"
			:guardrails="state.guardrails"
			@back="back"
			@saved="store.saved"
			@selected="
				state.editing = $event;
				store.policies();
			"
		/>
	</div>
</template>
