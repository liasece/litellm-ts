<script setup lang="ts">
import notificationManager from "../../notifications/logic/NotificationManager";
import { provideKeyFormIdentity } from "../support/KeyFormIdentity";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { requestJson } from "../../platform/api/HttpApiClient";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { virtualKeysApi } from "../api/VirtualKeysApi";
import { loadKeyCatalog } from "../data/KeyCatalogData";
import { applyKeyPrefill, createKeyDraft, validateKeyDraft } from "../logic/KeyDraftLogic";
import { buildKeyPayload } from "../logic/KeyPayloadLogic";
import { budgetFields, detailsFields } from "../render/KeyFormPresentation";
import { emptyKeyCatalog, markKeyField, recordValue, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import KeyAccordion from "./KeyAccordionComponent.vue";
import KeyOwnershipFields from "./KeyOwnershipFieldsComponent.vue";
import KeyFormFields from "./KeyFormFieldsComponent.vue";
import KeyField from "./KeyFieldComponent.vue";
import KeyLoggingFields from "./KeyLoggingFieldsComponent.vue";
import KeyRouterFields from "./KeyRouterFieldsComponent.vue";
import KeyAliasesFields from "./KeyAliasesFieldsComponent.vue";
import KeyLifecycleFields from "./KeyLifecycleFieldsComponent.vue";
import KeyOwnerUserDialog from "./KeyOwnerUserDialogComponent.vue";
import KeySecretDisplay from "./KeySecretDisplayComponent.vue";
import "./styles/VirtualKeyForms.css";

const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{
	catalog?: KeyCatalog;
	teamId?: string;
	lockTeam?: boolean;
	rows?: readonly VirtualKey[];
	prefill?: URLSearchParams;
}>();
const emit = defineEmits<{ created: [response: Record<string, unknown>] }>();
const auth = useAuthenticationStore();
const formatMoney = useMoneyFormatter();
const catalogData = ref<KeyCatalog>(emptyKeyCatalog());
const catalog = computed(() => props.catalog ?? catalogData.value);
const draft = ref(createKeyDraft());
const errors = ref<Record<string, string>>({});
const error = ref("");
const pending = ref(false);
const secret = ref("");
const optionalOpen = ref(false);
const userOpen = ref(false);
const premium = computed(() => auth.state.session?.premium_user ?? false);
const customDisabled = computed(() => Boolean(catalog.value.uiSettings.disable_custom_api_keys));
const selectedTeam = computed(() => catalog.value.teams.find((team) => team.team_id === draft.value.team_id));
const availableModels = ref<string[]>([]);
const models = computed(() => (availableModels.value.length ? availableModels.value : catalog.value.models));
const disabled = computed(() => models.value.includes("no-default-models") && !draft.value.team_id);
const budgets = computed(() => budgetFields(selectedTeam.value, true, formatMoney));
let generation = 0;
let modelRequest: AbortController | null = null;
watch(optionalOpen, (value) => {
	if (value) {
		markKeyField(draft.value, "tpm_limit_type");
		markKeyField(draft.value, "rpm_limit_type");
	}
});
watch(
	() => draft.value.team_id,
	async (teamId) => {
		modelRequest?.abort();
		const current = ++generation;
		if (!open.value) return;
		modelRequest = new AbortController();
		try {
			const value = await requestJson(
				"/models?include_model_access_groups=True&return_wildcard_routes=True" +
					(teamId ? "&team_id=" + encodeURIComponent(teamId) : ""),
				{ signal: modelRequest.signal },
			);
			if (generation === current) {
				const data = recordValue(value).data;
				availableModels.value = Array.isArray(data) ? data.map((model) => String(recordValue(model).id || "")).filter(Boolean) : [];
			}
		} catch {
			if (generation === current) availableModels.value = [];
		}
	},
);
watch(
	open,
	async (value) => {
		if (!value) {
			generation++;
			modelRequest?.abort();
			return;
		}
		draft.value = createKeyDraft();
		optionalOpen.value = false;
		secret.value = "";
		errors.value = {};
		error.value = "";
		availableModels.value = [];
		if (!props.catalog) catalogData.value = await loadKeyCatalog(props.teamId);
		if (!open.value) return;
		draft.value.team_id = props.teamId || "";
		const team = catalog.value.teams.find((team) => team.team_id === props.teamId);
		draft.value.organization_id = team?.organization_id || "";
		if (props.prefill) applyKeyPrefill(draft.value, props.prefill, catalog.value.teams, auth.userRole.value, catalog.value.models);
	},
	{ immediate: true },
);
async function submit() {
	errors.value = validateKeyDraft(draft.value, {
		creating: true,
		team: selectedTeam.value,
		customKeysDisabled: customDisabled.value,
		rows: props.rows,
	});
	if (Object.keys(errors.value).length) {
		await nextTick();
		document
			.querySelector(".vk-create-modal .ui-form-field--error input, .vk-create-modal .ui-form-field--error textarea")
			?.scrollIntoView({ block: "center" });
		return;
	}
	pending.value = true;
	error.value = "";
	notificationManager.info("Making API Call");
	try {
		const payload = buildKeyPayload(draft.value, {
			userId: auth.state.session?.user_id || "",
			customKeysDisabled: customDisabled.value,
		});
		const response = await virtualKeysApi.createKey(payload);
		notificationManager.success("Virtual Key Created");
		secret.value = String(response.key || "");
		draft.value = createKeyDraft();
		if (optionalOpen.value) {
			markKeyField(draft.value, "tpm_limit_type");
			markKeyField(draft.value, "rpm_limit_type");
		}
		emit("created", response);
		if (!secret.value) open.value = false;
	} catch (reason: unknown) {
		error.value = reason instanceof Error ? reason.message : "Error creating key";
		notificationManager.fromBackend(reason);
	} finally {
		pending.value = false;
	}
}
function createdUser(id: string) {
	draft.value.user_id = id;
}
onBeforeUnmount(() => {
	generation++;
	modelRequest?.abort();
});
provideKeyFormIdentity("key-create");
</script>
<template>
	<UiDialog
		v-model:open="open"
		:width="1000"
		:show-footer="false"
		scroll-mode="overlay"
		aria-label="Create New Key"
		class="vk-create-modal"
	>
		<form class="vk-create-form" @submit.prevent="submit">
			<UiAlert v-if="error" type="error" class="vk-form-error">{{ error }}</UiAlert>
			<KeyField
				label="Enabled"
				horizontal
				tooltip="When disabled, this key cannot be used for API requests. Re-enable it to restore access."
				tooltip-icon="QuestionCircleOutlined"
				><UiSwitch :model-value="!draft.blocked" label="Enabled" @update:model-value="draft.blocked = !$event">{{
					draft.blocked ? "Disabled" : "Enabled"
				}}</UiSwitch></KeyField
			>
			<KeyOwnershipFields
				v-model="draft"
				:catalog="catalog"
				:role="auth.userRole.value"
				:errors="errors"
				:lock-team="lockTeam"
				@create-user="userOpen = true"
			/>
			<div v-if="disabled" class="vk-team-required">
				Please select a team to continue configuring your Virtual Key. If you do not see any teams, please contact your Proxy Admin
				to either provide you with access to models or to add you to a team.
			</div>
			<template v-else>
				<section class="vk-form-section">
					<h2 class="vk-form-title">Key Details</h2>
					<KeyFormFields v-model="draft" :fields="detailsFields(draft, models, customDisabled)" :errors="errors" horizontal />
				</section>
				<section class="vk-form-section">
					<KeyAccordion v-model:open="optionalOpen" title="Optional Settings" large>
						<KeyFormFields v-model="draft" :fields="budgets" :errors="errors" horizontal />
						<div class="vk-create-logging-tooltip">
							<UiTooltip
								:title="
									premium
										? ''
										: 'Key-level logging settings is an enterprise feature, get in touch - https://www.litellm.ai/enterprise'
								"
								><div>
									<KeyAccordion title="Logging Settings" :disabled="!premium"
										><div class="vk-create-logging-content"><KeyLoggingFields v-model="draft" :catalog="catalog" /></div
									></KeyAccordion></div
							></UiTooltip>
						</div>
						<KeyAccordion title="Router Settings"><KeyRouterFields v-model="draft" :models="catalog.models" /></KeyAccordion>
						<KeyAccordion title="Model Aliases"
							><p class="vk-alias-intro">
								Create custom aliases for models that can be used in API calls. This allows you to create shortcuts for
								specific models.
							</p>
							<KeyAliasesFields v-model="draft" :models="catalog.models"
						/></KeyAccordion>
						<KeyAccordion title="Key Lifecycle"><KeyLifecycleFields v-model="draft" creating :errors="errors" /></KeyAccordion>
					</KeyAccordion>
				</section>
			</template>
			<footer class="vk-form-submit"><UiButton type="submit" :loading="pending" :disabled="disabled">Create Key</UiButton></footer>
		</form>
		<UiDialog
			:open="Boolean(secret) && open"
			:width="520"
			:show-footer="false"
			scroll-mode="overlay"
			aria-label="Save your Key"
			@update:open="open = false"
			><KeySecretDisplay :value="secret"
		/></UiDialog>
		<KeyOwnerUserDialog v-model:open="userOpen" :catalog="catalog" @created="createdUser" />
	</UiDialog>
</template>
