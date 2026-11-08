<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelCreateFields from "./ModelCreateFieldsComponent.vue";
import ModelProviderFields from "./ModelProviderFieldsComponent.vue";
import ModelAdvancedFields from "./ModelAdvancedFieldsComponent.vue";
import ModelConnectionTestDialog from "./ModelConnectionTestDialogComponent.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { prepareModelCreate, validateModelCreate, type ModelCreateDraft } from "../logic/ModelCreateLogic";
import { modelString, modelStrings, modelOptions, type ModelCatalog } from "../support/ModelModels";
import { modelsApi } from "../api/ModelsApi";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ catalog: ModelCatalog; admin: boolean; teamAdmin: boolean; premium: boolean; userId: string }>();
const emit = defineEmits<{ created: [] }>();
const values = ref<ModelCreateDraft>({ litellm_credential_name: null }),
	provider = ref("Anthropic"),
	teamOnly = ref(false),
	errors = ref<Record<string, string>>({}),
	pending = ref(false),
	testOpen = ref(false),
	testing = ref(false);
const prefix = nextUiIdentity("model-create");
const teamRequired = computed(() => props.teamAdmin && !props.admin),
	managed = computed(() => provider.value === "CLIProxy");
const fields = computed(() => props.catalog.providerFields.find((item) => item.provider === provider.value)?.credential_fields ?? []);
const teams = computed(() => props.catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id })));
function teamOnlyChange(enabled: boolean) {
	teamOnly.value = enabled;
	if (!enabled) delete values.value.team_id;
}
async function submit() {
	errors.value = validateModelCreate(values.value, fields.value, teamRequired.value);
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		const requests = prepareModelCreate(values.value);
		if (!requests.length) return;
		for (const request of requests) await modelsApi.createModel(request);
		values.value = { litellm_credential_name: null };
		emit("created");
	} catch (error) {
		notification.fromBackend("Failed to add model: " + (error instanceof Error ? error.message : String(error)));
	} finally {
		pending.value = false;
	}
}
function test() {
	testing.value = true;
	testOpen.value = true;
}
</script>
<template>
	<div class="model-add">
		<h2 class="model-ant-title">Add Model</h2>
		<UiCard appearance="antd" class="model-add-card"
			><form @submit.prevent="submit">
				<template v-if="teamRequired"
					><ModelField
						label="Select Team"
						:id="prefix + '-team-required'"
						required
						tooltip="Select the team for which you want to add this model"
						:error="errors.team_id"
						><UiSelect
							:id="prefix + '-team-required'"
							:model-value="modelString(values.team_id) || null"
							:options="teams"
							@update:model-value="values.team_id = $event" /></ModelField
					><UiAlert v-if="!values.team_id" type="info" title="Team Selection Required"
						>As a team admin, you need to select your team first before adding models.</UiAlert
					></template
				>
				<template v-if="admin || (teamRequired && values.team_id)">
					<ModelCreateFields v-model="values" v-model:provider="provider" :catalog="catalog" :errors="errors" :prefix="prefix" />
					<UiAlert v-if="managed" type="info" title="Credentials are managed by the built-in CLIProxy runtime"
						>Select an upstream model and public name only. LiteLLM supplies the internal endpoint and authentication
						automatically.</UiAlert
					>
					<template v-else
						><p class="model-credential-hint">Either select existing credentials OR enter new provider credentials below</p>
						<ModelField label="Existing Credentials" :id="prefix + '-credential'"
							><UiSelect
								:id="prefix + '-credential'"
								:model-value="modelString(values.litellm_credential_name) || '__none__'"
								:options="[
									{ value: '__none__', label: 'None' },
									...catalog.credentials.map((credential) => ({
										value: credential.credential_name,
										label: credential.credential_name,
									})),
								]"
								searchable
								clearable
								placeholder="Select or search for existing credentials"
								@update:model-value="values.litellm_credential_name = $event === '__none__' ? null : $event" /></ModelField
						><template v-if="!values.litellm_credential_name"
							><div class="model-divider"><span>OR</span></div>
							<ModelProviderFields
								v-model="values"
								:provider="provider"
								:catalog="catalog"
								:id-prefix="prefix"
								:errors="errors" /></template
					></template>
					<div class="model-divider"><span>Additional Model Info Settings</span></div>
					<ModelField
						v-if="admin || !teamAdmin"
						label="Team-BYOK Model"
						tooltip="Only use this model + credential combination for this team. Useful when teams want to onboard their own OpenAI keys."
						class="model-field--mb16 model-switch-field"
						><UiTooltip
							:title="
								!premium
									? 'This is an enterprise-only feature. Upgrade to premium to restrict model+credential combinations to a specific team.'
									: undefined
							"
							><UiSwitch
								:model-value="teamOnly"
								appearance="tremor"
								:disabled="!premium"
								@update:model-value="teamOnlyChange" /></UiTooltip
					></ModelField>
					<ModelField
						v-if="teamOnly && (admin || !teamAdmin)"
						label="Select Team"
						:id="prefix + '-team'"
						tooltip="Only keys for this team will be able to call this model."
						><UiSelect
							:id="prefix + '-team'"
							:model-value="modelString(values.team_id) || null"
							:options="teams"
							:disabled="!premium"
							@update:model-value="values.team_id = $event"
					/></ModelField>
					<ModelField
						v-if="admin"
						label="Model Access Group"
						:id="prefix + '-access-group'"
						tooltip="Use model access groups to give users access to select models, and add new ones to the group over time."
						class="model-field--mb16"
						><UiSelect
							:id="prefix + '-access-group'"
							:model-value="modelStrings(values.model_access_group)"
							max-tag-count="responsive"
							:options="modelOptions(catalog.accessGroups)"
							multiple
							searchable
							creatable
							:token-separators="[',']"
							clearable
							placeholder="Select existing groups or type to create new ones"
							@update:model-value="values.model_access_group = $event"
					/></ModelField>
					<ModelAdvancedFields v-model="values" :catalog="catalog" :errors="errors" :prefix="prefix" />
				</template>
				<div class="model-form-footer model-add-footer">
					<UiTooltip title="Get help on our github"
						><a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noreferrer">Need Help?</a></UiTooltip
					>
					<div>
						<UiButton :loading="testing" @click="test">Test Connect</UiButton
						><UiButton type="submit" :loading="pending">Add Model</UiButton>
					</div>
				</div>
			</form></UiCard
		><ModelConnectionTestDialog
			v-model:open="testOpen"
			:values="values"
			:model-name="modelString(values.model_name) || modelString(values.model) || 'this model'"
			@complete="testing = false"
		/>
	</div>
</template>
